use sqlx::{sqlite::SqliteRow, Row, SqlitePool};

/// Information of a packager
#[derive(sqlx::FromRow)]
pub struct Packager {
    pub tg_uid: i64,
    pub alias: String,
}

/// A single unit of the workList
#[derive(serde::Serialize)]
pub struct WorkListUnit {
    alias: String,
    /// make compatibility to the old api
    #[serde(rename = "packages")]
    assign: Vec<String>,
}

/// Get list of packager and their assigned packages
pub async fn get_working_list(db_conn: &SqlitePool) -> anyhow::Result<Vec<WorkListUnit>> {
    let packager: Vec<Packager> = sqlx::query_as("SELECT * FROM packager")
        .fetch_all(db_conn)
        .await?;

    let mut list = Vec::new();

    for p in packager {
        let assign = sqlx::query("SELECT name FROM pkg WHERE assignee=?")
            .bind(p.tg_uid)
            .map(|row: SqliteRow| row.get::<String, _>("name"))
            .fetch_all(db_conn)
            .await?;
        list.push(WorkListUnit {
            alias: p.alias,
            assign,
        })
    }

    Ok(list)
}

/// Information of a single mark.
#[derive(serde::Serialize, sqlx::FromRow)]
pub struct Mark {
    /// name of the mark
    name: String,
    /// Unix epoch timestamp represent when this mark generated. Use i64 here because sqlite
    /// doesn't support unsigned 64 bit integer number
    marked_at: i64,
    /// This is a private field which is used for unpack tg_uid column from query. So here skip the json
    /// serialization.
    #[serde(skip)]
    marked_by: i64,
    /// This is the public field for representing the alias name of the tg_uid field. It's value needs to
    /// be manually assigned. So by default sqlx will give it an Option::None value.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[sqlx(default)]
    by: Option<String>,
    /// Id of the message which generate this mark. Useful for targeting the discussion.
    /// Use i64 here because sqlite doesn't support unsigned 64bit integer number.
    msg_id: i64,
    /// Optional comment related with this mark
    comment: String,
}

/// A single unit for the `/pkg` route markList response
#[derive(serde::Serialize)]
pub struct MarkListUnit {
    /// Name of the package
    name: String,
    /// List of mark attach to the package
    marks: Vec<Mark>,
}

/// Query the database and get list of packages with their marks
pub async fn get_mark_list(db_conn: &SqlitePool) -> anyhow::Result<Vec<MarkListUnit>> {
    let pkgs: Vec<(i64, String)> = sqlx::query("SELECT id, name FROM pkg")
        .map(|row: SqliteRow| (row.get("id"), row.get("name")))
        .fetch_all(db_conn)
        .await?;

    let mut mark_list = Vec::with_capacity(pkgs.len());

    for p in pkgs {
        let (id, name) = p;

        let mut marks = sqlx::query_as::<_, Mark>(
            "SELECT
               name, marked_by, marked_at, msg_id, comment
             FROM mark
             WHERE for_pkg=?",
        )
        .bind(id)
        .fetch_all(db_conn)
        .await?;

        if marks.is_empty() {
            continue;
        }

        for m in &mut marks {
            let tgid = m.marked_by;
            let packager = find_packager(db_conn, FindPackagerProp::ByTgId(tgid)).await?;
            m.by = Some(packager.alias);
        }

        mark_list.push(MarkListUnit { name, marks })
    }

    Ok(mark_list)
}

/// Properties for finding an assignee
pub enum FindPackagerProp<'a> {
    ByPkgname(&'a str),
    ByTgId(i64),
}

impl<'a> FindPackagerProp<'a> {
    /// Generate query by corressbonding search property
    fn gen_query(
        self,
    ) -> sqlx::query::QueryAs<'a, sqlx::Sqlite, Packager, sqlx::sqlite::SqliteArguments<'a>> {
        match self {
            Self::ByTgId(id) => sqlx::query_as("SELECT * FROM packager WHERE tg_uid=?").bind(id),
            Self::ByPkgname(name) => sqlx::query_as(
                "SELECT * FROM packager WHERE tg_uid=(SELECT assignee FROM PKG WHERE name=?)",
            )
            .bind(name),
        }
    }
}

/// Find assignee information by multiple search property
pub async fn find_packager<'a>(
    db_conn: &SqlitePool,
    props: FindPackagerProp<'a>,
) -> anyhow::Result<Packager> {
    let query = props.gen_query();
    let packager = query.fetch_one(db_conn).await?;
    Ok(packager)
}
