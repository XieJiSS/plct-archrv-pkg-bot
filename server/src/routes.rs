use super::sql;

use actix_web::{get, HttpResponse};

/// Runtime necessary data.
pub struct State {
    /// connection pool to the sqlite database
    pub db_conn: sqlx::SqlitePool,
}

/// Alias of the application state data
type Data = actix_web::web::Data<State>;

/// Default JSON response when some internal error occur. The msg field should contains friendly
/// hint for debugging. And detail field contains the original error.
#[derive(serde::Serialize)]
struct ErrorJsonResp<'m> {
    msg: &'m str,
    detail: String,
}

#[get("/add")]
pub(super) async fn add() -> HttpResponse {
    todo!()
}

/// Present the JSON response for route `/pkg`.
///
/// The workList contains the package assignment status. And markList contains the marks for each
/// package.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PkgJsonResponse {
    work_list: Vec<sql::WorkListUnit>,
    mark_list: Vec<sql::MarkListUnit>,
}

/// Implementation of route `/pkg`
#[get("/pkg")]
pub(super) async fn pkg(data: Data) -> HttpResponse {
    let work_list = sql::get_working_list(&data.db_conn).await;
    if let Err(err) = work_list {
        return HttpResponse::InternalServerError().json(ErrorJsonResp {
            msg: "fail to get working list",
            detail: err.to_string(),
        });
    }

    let mark_list = sql::get_mark_list(&data.db_conn).await;
    if let Err(err) = mark_list {
        return HttpResponse::InternalServerError().json(ErrorJsonResp {
            msg: "fail to get mark list",
            detail: err.to_string(),
        });
    }

    HttpResponse::Ok().json(PkgJsonResponse {
        work_list: work_list.unwrap(),
        mark_list: mark_list.unwrap(),
    })
}

#[get("/delete")]
pub(super) async fn delete() -> HttpResponse {
    todo!()
}
