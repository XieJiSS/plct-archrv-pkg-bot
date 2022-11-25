//! This is a lightweight and simple wrap up API for the telegram bot.
//! Most of the telegram bot library are very exhaustive and therefore
//! the code base are bloated. Currently all we need is just
//! `sendMessage` and `deleteMessage` api.
//!
//! The send_message will not send message immediately.
//! Each send_message call is just enqueue the text into a queue.
//! The bot will automatically dequeue the message queue in a constant period,
//! and merge them into a single message.
//! That duration might be 1s or 500ms, to avoid massive message send to group
//! and causing spam. It is configurable by environment variable `$NOTIFY_PERIOD`.

use std::time::Duration;
use tokio::{
    sync::mpsc::{self, UnboundedReceiver, UnboundedSender},
    task::JoinHandle,
    time::interval,
};

/// Runtime require information of a telegram bot.
/// It is only used for operation, not for listening update.
struct BotProp {
    /// Group ID for message notification
    group_id: i64,
    /// A HTTP client for making request
    http: reqwest::Client,
    /// The url to the bot api server
    api_endpoint: reqwest::Url,
}

/// Hold the two parallel handle, shutdown them when ctrl-c pressed
pub struct BotHandler {
    /// Sender for user to enqueue message
    sender: UnboundedSender<String>,
    queue_worker: JoinHandle<()>,
    bot_worker: JoinHandle<()>,
}

impl BotHandler {
    /// Initialize a new telegram bot, require `token` for telegram bot api authentication and a
    /// group_id to send notification.
    pub fn new(token: &str, group_id: i64) -> Self {
        use reqwest::{Client, Url};
        let final_url = format!("https://api.telegram.org/bot{token}/");
        let prop = BotProp {
            group_id,
            http: Client::new(),
            api_endpoint: Url::parse(&final_url).unwrap(),
        };

        // a public channel that will be exposed to user
        let (enqueue, queue_chan) = mpsc::unbounded_channel();
        // an internal channel that only works between bot and the queue
        let (to_bot, bot_chan) = mpsc::unbounded_channel();

        // Spawn two parallel task
        // `queue_worker`: receive and store message from user. Send those message when duration
        // consumed.
        // `bot_worker`: receive message from queue, and immediately send them to Telegram group.
        let queue_worker = tokio::spawn(msg_queue_task(queue_chan, to_bot));
        let bot_worker = tokio::spawn(listen_task(prop, bot_chan));

        Self {
            sender: enqueue,
            queue_worker,
            bot_worker,
        }
    }

    /// A delayed `send_message` method. It will enqueue the given text and only send them if
    /// a time period consumed. If there were multiple text in a short period, like 500ms, they
    /// will be merged into one message.
    pub async fn send_message(&self, text: &str) {
        self.sender.send(text.to_string()).unwrap();
    }
}

async fn msg_queue_task(mut queue: UnboundedReceiver<String>, bot: UnboundedSender<String>) {
    let mut message_queue = Vec::new();
    // TODO: make duration configurable
    let mut heartbeat = interval(Duration::from_millis(1000));

    loop {
        tokio::select! {
            _ = heartbeat.tick() => {
                if message_queue.is_empty() {
                    continue;
                }

                let merged = message_queue
                    .drain(..)
                    .fold(String::new(), |folded, current| {
                        format!("{folded}{current}\n")
                    });
                // panic if we got logic error that must be found out reason
                bot.send(merged).expect("channel should be opened, but got an unexpected closed channel");
            }
            msg = queue.recv() => {
                let Some(text) = msg else {
                    // if we get None, it means that the send channel has been closed
                    break;
                };
                message_queue.push(text);
            }
        }
    }
}

async fn listen_task(prop: BotProp, mut recver: UnboundedReceiver<String>) {
    let BotProp {
        group_id,
        http,
        api_endpoint,
        ..
    } = prop;

    let api = api_endpoint.join("sendMessage").unwrap();

    #[derive(serde::Serialize)]
    struct SendMsgParam {
        chat_id: i64,
        text: String,
        parse_mode: &'static str,
    }

    while let Some(text) = recver.recv().await {
        let param = SendMsgParam {
            chat_id: group_id,
            text: text.to_string(),
            parse_mode: "HTML",
        };

        tracing::trace!(full_content = text, "sending message");
        let resp = http.post(api.as_str()).json(&param).send().await;
        if let Err(err) = &resp {
            tracing::error!("fail to send request to telegram: {err}")
        }
        let resp = resp.unwrap();
        if resp.status() != reqwest::StatusCode::OK {
            let response = resp.json::<ErrorResp>().await;
            if response.is_err() {
                tracing::error!("fail to send request, also the api doesn't response as expected")
            }
            let response = response.unwrap();
            tracing::error!("fail to send message: {}", response.description)
        }
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

#[tokio::test(flavor = "multi_thread")]
async fn test_send_message() {
    dotenvy::dotenv().ok();
    let token = std::env::var("TEST_BOT_TOKEN")
        .expect("TEST_BOT_TOKEN should be set before the test started");
    let group = std::env::var("TEST_GROUP_ID")
        .expect("TEST_GROUP_ID should be set before the test started");
    let group = group
        .parse::<i64>()
        .expect("TEST_GROUP_ID should be a valid i64 number");

    let bot = BotHandler::new(&token, group);
    bot.send_message(
        "<b>Test Message</b>\n<code>if you see this message with markup, test is pass</code>",
    )
    .await;

    tokio::time::sleep(Duration::from_millis(1200)).await;
    bot.send_message("Multiple text 1").await;
    bot.send_message("Multiple text 2").await;
    bot.send_message("Multiple text 3").await;
    bot.send_message("Multiple text 4").await;
    bot.send_message("Multiple text 5").await;
    bot.send_message("Multiple text 6").await;
    bot.send_message(
        "If you see 6 <code>Multiple Text *</code> combine with this message, test is pass",
    )
    .await;
    tokio::time::sleep(Duration::from_millis(1200)).await;
}
