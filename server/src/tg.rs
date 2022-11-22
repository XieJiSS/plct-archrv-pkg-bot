//! This is a lightweight and simple wrap up API for the telegram bot.
//! Most of the telegram bot library are very exhaustive and therefore
//! the code base are bloated. Currently all we need is just
//! `sendMessage` and `deleteMessage` api.

/// Runtime require information of a telegram bot.
/// It is only used for operation, not for listening update.
pub struct Bot {
    /// Group ID for message notification
    group_id: i64,
    /// A HTTP client for making request
    http: reqwest::Client,
    /// The url to the bot api server
    api_endpoint: reqwest::Url,
}

impl Bot {
    /// Initialize a new telegram bot, require `token` for telegram bot api authentication and a
    /// group_id to send notification.
    pub fn new(token: &str, group_id: i64) -> Self {
        use reqwest::{Client, Url};
        let final_url = format!("https://api.telegram.org/bot{token}/");

        Self {
            http: Client::new(),
            api_endpoint: Url::parse(&final_url).unwrap(),
            group_id,
        }
    }

    /// Send the text to `group_id` in HTML markup.
    pub async fn send_message(&self, text: &str) -> anyhow::Result<()> {
        let api = self.api_endpoint.join("sendMessage").unwrap();

        #[derive(serde::Serialize)]
        struct SendMsgParam {
            chat_id: i64,
            text: String,
            parse_mode: &'static str,
        }

        let param = SendMsgParam {
            chat_id: self.group_id,
            text: text.to_string(),
            parse_mode: "HTML",
        };

        let resp = self.http.post(api).json(&param).send().await?;
        if resp.status() != reqwest::StatusCode::OK {
            let error: ErrorResp = resp.json().await?;
            anyhow::bail!("fail to send request: {}", error.description);
        }

        Ok(())
    }
}

#[derive(serde::Deserialize)]
pub struct ErrorResp {
    description: String,
}

/// Generate link in HTML <a href=...> format which can be used for mention a member in group.
pub fn gen_mention_link(name: &str, id: i64) -> String {
    format!(r#"<a href="tg://user?id={id}">{name}</a>"#)
}

#[test]
fn test_send_message() {
    dotenvy::dotenv().ok();
    let token = std::env::var("TEST_BOT_TOKEN")
        .expect("TEST_BOT_TOKEN should be set before the test started");
    let group = std::env::var("TEST_GROUP_ID")
        .expect("TEST_GROUP_ID should be set before the test started");
    let group = group
        .parse::<i64>()
        .expect("TEST_GROUP_ID should be a valid i64 number");

    let bot = Bot::new(&token, group);
    let rt = tokio::runtime::Runtime::new().unwrap();
    let result = rt.block_on(bot.send_message(
        "<b>Test Message</b>\n<code>if you see this message with markup, test is pass</code>",
    ));
    if let Err(err) = &result {
        dbg!(err);
    }
    assert!(result.is_ok())
}
