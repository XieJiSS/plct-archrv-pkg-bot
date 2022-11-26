use super::{sql, tg};

use actix_web::{get, web, HttpResponse};
use anyhow::Context;

/// Runtime necessary data.
pub struct State {
    /// connection pool to the sqlite database
    pub db_conn: sqlx::SqlitePool,
    pub token: String,
    pub bot: tg::BotHandler,
}

/// Alias of the application state data
type Data = actix_web::web::Data<State>;

#[derive(Debug, serde::Serialize)]
enum ReqStatus {
    Ok,
    Fail,
}

/// Default JSON response when some internal error occur. The msg field should contains friendly
/// hint for debugging. And detail field contains the original error.
#[derive(serde::Serialize)]
struct MsgResp {
    status: ReqStatus,
    msg: String,
    detail: String,
}

impl MsgResp {
    fn new_200_msg<D: ToString>(detail: D) -> HttpResponse {
        HttpResponse::Ok().json(Self {
            status: ReqStatus::Ok,
            msg: "Request success".to_string(),
            detail: detail.to_string(),
        })
    }

    /// Create a new Internal Server Error (ise) response
    fn new_500_resp<M, D>(msg: M, detail: D) -> HttpResponse
    where
        M: ToString,
        D: ToString,
    {
        HttpResponse::InternalServerError().json(Self {
            status: ReqStatus::Fail,
            msg: msg.to_string(),
            detail: detail.to_string(),
        })
    }

    fn new_403_resp<M: ToString>(detail: M) -> HttpResponse {
        HttpResponse::Forbidden().json(Self {
            status: ReqStatus::Fail,
            msg: "forbidden".to_string(),
            detail: detail.to_string(),
        })
    }

    fn new_400_resp<M: ToString>(detail: M) -> HttpResponse {
        HttpResponse::BadRequest().json(Self {
            status: ReqStatus::Fail,
            msg: "bad request".to_string(),
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
        return MsgResp::new_500_resp("fail to get working list", err);
    }

    let mark_list = sql::Mark::fetch_all(&data.db_conn).await;
    if let Err(err) = mark_list {
        return MsgResp::new_500_resp("fail to get mark list", err);
    }

    HttpResponse::Ok().json(PkgJsonResponse {
        work_list: work_list.unwrap(),
        mark_list: mark_list.unwrap(),
    })
}

#[derive(serde::Deserialize)]
pub struct RouteDeletePathSegment {
    pkgname: String,
    status: String,
}

#[derive(serde::Deserialize)]
pub struct RouteDeleteQuery {
    token: String,
}

#[get("/delete/{pkgname}/{status}")]
pub(super) async fn delete(
    path: web::Path<RouteDeletePathSegment>,
    q: web::Query<RouteDeleteQuery>,
    data: Data,
) -> HttpResponse {
    if q.token != data.token {
        return MsgResp::new_403_resp("invalid token");
    }

    if !["ftbfs", "leaf"].contains(&path.status.as_str()) {
        return MsgResp::new_400_resp(format!("Required 'ftbfs' or 'leaf', get {}", path.status));
    }

    let packager =
        sql::Packager::search(&data.db_conn, sql::FindPackagerBy::Pkgname(&path.pkgname)).await;
    if let Err(err) = packager {
        return MsgResp::new_500_resp("fail to fetch packager", err);
    }
    let packager = packager.unwrap();

    let prefix = "<code>(auto-merge)</code>";
    let text = format!(
        "{prefix} ping {}: {} 已出包",
        tg::gen_mention_link(&packager.alias, packager.tg_uid),
        path.pkgname
    );

    data.bot.send_message(&text).await;

    if let Err(err) = sql::drop_assign(&data.db_conn, &path.pkgname, packager.tg_uid).await {
        let text = format!("{prefix} failed: {err}");
        data.bot.send_message(&text).await
    };

    let mut tasks = Vec::with_capacity(2);
    // Data and pkgname memory will be moved into the below scope, so we need to copy the data for
    // later task to use.
    // actix_web::Data is just a wrapper for Arc, copy is cheap here. Pkgname is not some large
    // data, so it is also accpetable to copy them.
    let data_ref = data.clone();
    let pkgname = path.pkgname.to_string();
    tasks.push(tokio::spawn(async move {
        let matches = &[
            "outdated",
            "stuck",
            "ready",
            "outdated_dep",
            "missing_dep",
            "unknown",
            "ignore",
            "failing",
        ];
        let result = sql::Mark::remove(&data_ref.db_conn, &pkgname, Some(matches)).await;
        match result {
            Ok(deleted) => {
                let marks = deleted.join(",");
                data_ref
                    .bot
                    .send_message(&format!(
                        "<code>(auto-unmark)</code> {pkgname} 已出包，不再标记为：{marks}"
                    ))
                    .await
            }
            Err(err) => {
                data_ref
                    .bot
                    .send_message(&format!(
                        "fail to delete marks for {pkgname}: \n<code>{err}</code>"
                    ))
                    .await
            }
        }
    }));

    // copy again
    let pkgname = path.pkgname.to_string();
    tasks.push(tokio::spawn(async move {
        let clear_result = clear_related_package(&data.db_conn, &pkgname).await;
        if let Err(err) = clear_result {
            data.bot
                .send_message(&format!(
                    "fail to clean related package for {pkgname}\n\nDetails:\n{err}"
                ))
                .await;
            return;
        }
        let replies = clear_result.unwrap();
        for repl in replies {
            data.bot.send_message(&repl).await;
        }
    }));

    for t in tasks {
        let result = t.await;
        if let Err(err) = result {
            MsgResp::new_500_resp("Execution fail", err);
        }
    }

    MsgResp::new_200_msg("package deleted")
}

// resolve the relation and auto cc
// prepare a list of replies and return
async fn clear_related_package(
    db_conn: &sqlx::SqlitePool,
    pkgname: &str,
) -> anyhow::Result<Vec<String>> {
    use sql::*;
    let related_mark = ["outdated_dep", "missing_dep"];
    // first search a list of package related with this ready package
    let requested: Vec<_> = PkgRelation::search(db_conn, PkgRelationSearchBy::Required(&[pkgname]))
        .await
        .with_context(|| "fail to search related package")?
        .into_iter()
        .filter(|rel| related_mark.contains(&rel.relation.as_str()))
        .map(|rel| rel.request)
        .collect();

    if requested.is_empty() {
        anyhow::bail!("no relation found")
    }

    let mut replies = Vec::new();
    let prefix = "<code>(auto-unmark)</code>";
    // then reverse search back, check that if the ready package is the only package of the
    // dependency list or a part of it, then take action on the different condition
    for package in requested {
        let relation: Vec<_> = sql::PkgRelation::search(
            db_conn,
            PkgRelationSearchBy::Request(&[package.name.as_str()]),
        )
        .await?
        .into_iter()
        .filter(|rel| related_mark.contains(&rel.relation.as_str()))
        .collect();
        if relation.is_empty() {
            continue;
        }
        let Some(position) = relation
            .iter()
            .position(|rel| rel.required.name == pkgname) else { continue; };

        let rel = &relation[position];

        replies.push(format!(
            "<code>(auto-cc)</code> ping {}:",
            tg::gen_mention_link(&rel.created_by.alias, rel.created_by.tg_uid)
        ));
        // the package only required `pkgname` to be ready, so it's also ready
        if relation.len() == 1 {
            Mark::remove(db_conn, &rel.request.name, Some(&[rel.relation.as_str()])).await?;
            replies.push(format!(
                "{prefix} {} 因 {} 已出包，不再标记为 {:?}",
                rel.request.name, pkgname, rel.relation
            ));
        } else {
            replies.push(format!(
                "{prefix} {} 已从 {} 的 {} 状态中移除",
                pkgname, rel.request.name, rel.relation
            ));
        }

        PkgRelation::remove(
            db_conn,
            &rel.relation,
            PkgRelationSearchBy::Required(&[rel.required.name.as_str()]),
        )
        .await?;
    }

    Ok(replies)
}
