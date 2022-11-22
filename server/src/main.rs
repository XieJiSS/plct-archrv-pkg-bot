use actix_web::{App, HttpServer};
use anyhow::Context;
use std::env;

mod sql;
mod routes;
mod sql;
mod tg;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    // user must give us a database url
    let database_url = env::var("DATABASE_URL").with_context(|| "fail to get database url")?;
    let sqlite = sqlx::SqlitePool::connect(&database_url).await?;
    // if $LISTEN_ADDR not found, use default "0.0.0.0"
    let listen_addr = env::var("LISTEN_ADDR").unwrap_or_else(|_| "0.0.0.0".to_string());
    // if $LISTEN_PORT env exist, but it is not a valid port number, return default
    // if $LISTEN_PORT env doesn't exist, return default
    let listen_port = env::var("LISTEN_PORT")
        .map(|port| port.parse::<u16>().unwrap_or(11451))
        .unwrap_or(11451);
    let token = env::var("HTTP_API_TOKEN").with_context(|| "fail to get auth token")?;
    let group_id = env::var("GROUP_ID").map(|id| {
        id.parse::<i64>()
            .expect("GROUP_ID should be a valid signed 64bit integer number")
    })?;

    let bot = tg::Bot::new(&token, group_id);

    let state = routes::State {
        db_conn: sqlite,
        bot,
        token,
    };

    run((listen_addr, listen_port), sqlite).await
}

async fn run(server_binding: (String, u16), db_conn: sqlx::SqlitePool) -> anyhow::Result<()> {
    let state = routes::State { db_conn };
    let data = actix_web::web::Data::new(state);

    HttpServer::new(move || {
        App::new()
            .service(routes::add)
            .service(routes::pkg)
            .service(routes::delete)
            .app_data(data.clone())
    })
    .bind(server_binding)?
    .run()
    .await?;

    Ok(())
}
