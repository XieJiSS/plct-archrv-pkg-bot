use std::collections::HashMap;

use actix_web::{HttpResponse, get};

#[get("/add")]
pub(super) async fn add() -> HttpResponse {
    HttpResponse::Ok().json(HashMap::from([("msg", "/add")]))
}

#[get("/pkg")]
pub(super) async fn pkg() -> HttpResponse {
    HttpResponse::Ok().json(HashMap::from([("msg", "/pkg")]))
}

#[get("/delete")]
pub(super) async fn delete() -> HttpResponse {
    HttpResponse::Ok().json(HashMap::from([("msg", "/delete")]))
}
