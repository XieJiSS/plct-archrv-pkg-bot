use super::sql;
use std::collections::HashMap;

use actix_web::{get, HttpResponse};

pub struct State {
    pub db_conn: sqlx::SqlitePool,
}

type Data = actix_web::web::Data<State>;

#[derive(serde::Serialize)]
struct ErrorJsonResp<'m> {
    msg: &'m str,
    details: String,
}

#[get("/add")]
pub(super) async fn add() -> HttpResponse {
    HttpResponse::Ok().json(HashMap::from([("msg", "/add")]))
}

#[get("/pkg")]
pub(super) async fn pkg(data: Data) -> HttpResponse {
    let data = sql::get_working_list(&data.db_conn).await;
    match data {
        Ok(data) => HttpResponse::Ok().json(data),
        Err(err) => HttpResponse::InternalServerError().json(ErrorJsonResp {
            msg: "fail to get working list",
            details: err.to_string(),
        }),
    }
}

#[get("/delete")]
pub(super) async fn delete() -> HttpResponse {
    HttpResponse::Ok().json(HashMap::from([("msg", "/delete")]))
}
