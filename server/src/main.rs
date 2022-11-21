use actix_web::{App, HttpServer};

mod routes;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    run().await
}

async fn run() -> anyhow::Result<()> {
    use routes::*;
    HttpServer::new(|| {
        App::new()
            .service(add)
            .service(pkg)
            .service(delete)
    })
    .bind(("0.0.0.0", 11451))?
    .run().await?;

    Ok(())
}
