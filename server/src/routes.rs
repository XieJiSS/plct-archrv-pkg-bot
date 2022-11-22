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
struct ErrorJsonResp {
    msg: String,
    detail: String,
}

impl ErrorJsonResp {
    /// Create a new Internal Server Error (ise) response
    fn new_ise_resp<M, D>(msg: M, detail: D) -> HttpResponse
    where
        M: ToString,
        D: ToString,
    {
        HttpResponse::InternalServerError().json(Self {
            msg: msg.to_string(),
            detail: detail.to_string(),
        })
    }
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
        return ErrorJsonResp::new_ise_resp("fail to get working list", err);
    }

    let mark_list = sql::get_mark_list(&data.db_conn).await;
    if let Err(err) = mark_list {
        return ErrorJsonResp::new_ise_resp("fail to get mark list", err);
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
