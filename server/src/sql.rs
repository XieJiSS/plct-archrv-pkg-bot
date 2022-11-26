use sqlx::{sqlite::SqliteRow, Row, SqlitePool};

const RELATION_LIST: [&str; 2] = ["missing_dep", "outdated_dep"];

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
        let assign: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM pkg WHERE id IN (SELECT pkg FROM assignment WHERE assignee=?)",
        )
        .bind(p.tg_uid)
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
    pub name: String,
    /// Unix epoch timestamp represent when this mark generated. Use i64 here because sqlite
    /// doesn't support unsigned 64 bit integer number
    pub marked_at: i64,
    /// This is a private field which is used for unpack tg_uid column from query. So here skip the json
    /// serialization.
    #[serde(skip)]
    pub marked_by: i64,
    /// This is the public field for representing the alias name of the tg_uid field. It's value needs to
    /// be manually assigned. So by default sqlx will give it an Option::None value.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[sqlx(default)]
    pub by: Option<String>,
    /// Id of the message which generate this mark. Useful for targeting the discussion.
    /// Use i64 here because sqlite doesn't support unsigned 64bit integer number.
    pub msg_id: i64,
    /// Optional comment related with this mark
    pub comment: String,
    /// Which package is this mark for. Should be private so here I skip serialize it into JSON.
    #[serde(skip)]
    pub for_pkg: i64,
}

pub enum SearchMarksBy<'a> {
    PkgId(i64),
    NamePats(&'a [&'a str]),
}

impl Mark {
    pub async fn search<'a>(
        db_conn: &SqlitePool,
        prop: SearchMarksBy<'a>,
    ) -> anyhow::Result<Vec<Self>> {
        let query = match prop {
            SearchMarksBy::PkgId(id) => {
                sqlx::query_as::<_, Self>("SELECT * FROM mark WHERE for_pkg=?").bind(id)
            }
            SearchMarksBy::NamePats(patterns) => {
                sqlx::query_as::<_, Self>("SELECT * FROM mark WHERE name IN (?)")
                    .bind(patterns.join(","))
            }
        };
        Ok(query.fetch_all(db_conn).await?)
    }

    /// Query the database and get list of packages with their marks
    pub async fn fetch_all(db_conn: &SqlitePool) -> anyhow::Result<Vec<MarkListUnit>> {
        let pkgs = sqlx::query_as::<_, Pkg>("SELECT * FROM pkg")
            .fetch_all(db_conn)
            .await?;
        let mut mark_list = Vec::with_capacity(pkgs.len());
        for p in pkgs {
            let mut marks = Mark::search(db_conn, SearchMarksBy::PkgId(p.id)).await?;
            if marks.is_empty() {
                continue;
            }

            for m in &mut marks {
                let tgid = m.marked_by;
                let packager = find_packager(db_conn, FindPackagerProp::ByTgId(tgid)).await?;
                m.by = Some(packager.alias);
            }

            mark_list.push(MarkListUnit {
                name: p.name,
                marks,
            })
        }
        Ok(mark_list)
    }

    /// Remove marks for the given package. User can gives a list of extra matches to remove a range of
    /// mark. Return a list of deleted marks.
    ///
    /// # Example
    ///
    /// ```rust
    /// // remove all marks for package "rustup"
    /// remove_marks(&conn, "rustup")
    ///
    /// // remove marks that is "upstreamed" or "flaky" for package "ltrace"
    /// remove_marks(&conn, "ltrace", Some(&["upstreamed", "flaky"]))
    /// ```
    /// TODO: merge this function into Mark struct's namespace
    pub async fn remove(
        db_conn: &SqlitePool,
        pkgname: &str,
        matches: Option<&[&str]>,
    ) -> anyhow::Result<Vec<String>> {
        let pkg = Pkg::search(db_conn, SearchPkgBy::Name(pkgname.to_string())).await?;
        if pkg.is_empty() {
            anyhow::bail!("package doesn't exist, fail to remove marks");
        }
        let pkg = &pkg[0];

        let query = if let Some(matches) = matches {
            if matches.is_empty() {
                anyhow::bail!("invalid matches argument");
            }

            // HACK: sqlx doesn't support Vec<T> as value, so I have to manually join them
            // with comma. But it is very hacky and I can't guarantee it will work robustly.
            // Tracking issue: https://github.com/launchbadge/sqlx/issues/875.
            sqlx::query_as::<_, Mark>(
                r#"DELETE FROM mark
        WHERE for_pkg=? AND name IN ?
        RETURNING *"#,
            )
            .bind(pkg.id)
            .bind(matches.join(","))
        } else {
            // if user doesn't give us matches, remove all
            sqlx::query_as::<_, Mark>("DELETE FROM mark WHERE for_pkg=? RETURNING *").bind(pkg.id)
        };

        let deleted = query.fetch_all(db_conn).await?;
        if deleted.is_empty() {
            anyhow::bail!("No marks found for this package")
        }

        if let Some(marks) = matches {
            for mark in marks {
                if !RELATION_LIST.contains(mark) {
                    continue;
                }
                // remove outdated_dep/missing_dep relationship when marks are cleared
                PkgRelation::remove(db_conn, mark, PkgRelationSearchBy::Required(&[pkgname]))
                    .await?;
            }
        }

        Ok(deleted.into_iter().map(|mark| mark.name).collect())
    }
}

/// A single unit for the `/pkg` route markList response
#[derive(serde::Serialize)]
pub struct MarkListUnit {
    /// Name of the package
    name: String,
    /// List of mark attach to the package
    marks: Vec<Mark>,
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

#[allow(unused)]
#[derive(sqlx::FromRow)]
pub struct Assignment {
    id: i64,
    #[sqlx(rename = "pkg")]
    pkg_id: i64,
    assignee: i64,
    assigned_at: i64,
}

/// Drop assignment by pkgname and packager id
pub async fn drop_assign(db_conn: &SqlitePool, pkgname: &str, packager: i64) -> anyhow::Result<()> {
    let pkginfo: Vec<Assignment> = sqlx::query_as("SELECT * FROM assignment WHERE assignee=?")
        .bind(packager)
        .fetch_all(db_conn)
        .await?;

    if pkginfo.is_empty() {
        anyhow::bail!("你还没有认领任何 package")
    }

    let pkg_id: i64 = sqlx::query("SELECT id FROM pkg WHERE name=?")
        .bind(pkgname)
        .map(|row: SqliteRow| row.get("id"))
        .fetch_one(db_conn)
        .await?;

    let Some(pending_drop) = pkginfo.iter().find(|pkg| pkg.pkg_id == pkg_id) else {
        anyhow::bail!("这个 package 不在你的认领记录里")
    };

    sqlx::query("DELETE FROM assignment WHERE id=?")
        .bind(pending_drop.id)
        .execute(db_conn)
        .await?;

    Ok(())
}

#[derive(sqlx::FromRow)]
pub struct Pkg {
    pub id: i64,
    pub name: String,
}

pub enum SearchPkgBy {
    // search package by its database row id
    Id(i64),
    // search package by its name
    Name(String),
}

impl Pkg {
    pub async fn search(db_conn: &SqlitePool, prop: SearchPkgBy) -> anyhow::Result<Vec<Self>> {
        let query = match prop {
            SearchPkgBy::Id(id) => {
                sqlx::query_as::<_, Self>("SELECT * FROM pkg WHERE id=?").bind(id)
            }
            SearchPkgBy::Name(name) => {
                sqlx::query_as::<_, Self>("SELECT * FROM pkg WHERE name=?").bind(name)
            }
        };
        Ok(query.fetch_all(db_conn).await?)
    }
}

/// Relation between packages, like outdate_deps.
pub struct PkgRelation {
    pub relation: String,
    pub request: Pkg,
    pub required: Pkg,
}

/// The original data structure for convenient deserialize from database row
#[derive(sqlx::FromRow)]
struct Relation {
    relation: String,
    required: String,
    request: String,
}

pub enum PkgRelationSearchBy<'a> {
    Request(&'a [&'a str]),
    Required(&'a [&'a str]),
}

impl PkgRelation {
    async fn wrap_up(db_conn: &SqlitePool, row: Vec<Relation>) -> anyhow::Result<Vec<Self>> {
        let mut ret = Vec::new();
        for row in row {
            let mut required_by_pkg_info =
                Pkg::search(db_conn, SearchPkgBy::Name(row.request)).await?;
            let mut required_pkg_info =
                Pkg::search(db_conn, SearchPkgBy::Name(row.required)).await?;
            if required_by_pkg_info.is_empty() || required_pkg_info.is_empty() {
                continue;
            }
            let pkg_relation = PkgRelation {
                relation: row.relation,
                request: required_by_pkg_info.swap_remove(0),
                required: required_pkg_info.swap_remove(0),
            };
            ret.push(pkg_relation)
        }

        if ret.is_empty() {
            anyhow::bail!("no relation ship found on your argument")
        }

        Ok(ret)
    }

    pub async fn search(
        db_conn: &SqlitePool,
        prop: PkgRelationSearchBy<'_>,
    ) -> anyhow::Result<Vec<Self>> {
        let query = match prop {
            PkgRelationSearchBy::Request(pkg) => {
                sqlx::query_as::<_, Relation>("SELECT * FROM pkg_relation WHERE related IN (?)")
                    .bind(pkg.join(","))
            }
            PkgRelationSearchBy::Required(pkg) => {
                sqlx::query_as::<_, Relation>("SELECT * FROM pkg_relation WHERE required IN (?)")
                    .bind(pkg.join(","))
            }
        };
        let relation = query.fetch_all(db_conn).await?;

        Self::wrap_up(db_conn, relation).await
    }

    pub async fn remove(
        db_conn: &SqlitePool,
        relation: &str,
        prop: PkgRelationSearchBy<'_>,
    ) -> anyhow::Result<Vec<Self>> {
        let query = match prop {
            PkgRelationSearchBy::Request(pkg) => sqlx::query_as::<_, Relation>(
                "DELETE FROM pkg_relation WHERE related IN (?) AND relation=?",
            )
            .bind(pkg.join(","))
            .bind(relation)
            .bind(pkg.join(",")),
            PkgRelationSearchBy::Required(pkg) => sqlx::query_as::<_, Relation>(
                "DELETE FROM pkg_relation WHERE required IN (?) AND relation=?",
            )
            .bind(pkg.join(","))
            .bind(relation)
            .bind(pkg.join(",")),
        };

        let deleted = query.fetch_all(db_conn).await?;

        Self::wrap_up(db_conn, deleted).await
    }
}
