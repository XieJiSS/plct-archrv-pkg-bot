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
