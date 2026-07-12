// Has the background task for the streak reminder push notifications
//
// Subscriptions are written by the frontend directly through Supabase (push.js).
// This backend only reads the table to send reminders.

use ::sqlx::types::{chrono::{NaiveDate, Utc}, Uuid};
use chrono_tz::Tz;
use rocket::{fairing::AdHoc, tokio};
use rocket_db_pools::sqlx::{self, PgPool, Row};
use web_push::{
    ContentEncoding, HyperWebPushClient, PartialVapidSignatureBuilder, SubscriptionInfo, Urgency,
    VapidSignatureBuilder, WebPushClient, WebPushError, WebPushMessageBuilder,
};

use std::{collections::HashMap, env, error::Error, time::Duration};

/*
CREATE TABLE push_subscriptions (
    id serial PRIMARY KEY,
    endpoint VARCHAR NOT NULL UNIQUE,
    user_id UUID NOT NULL DEFAULT auth.uid(),
    p256dh VARCHAR NOT NULL,
    auth VARCHAR NOT NULL,
    timezone VARCHAR NOT NULL DEFAULT 'UTC',
    current_streak INTEGER NOT NULL DEFAULT 0,
    last_active_date DATE,
    last_notified_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX push_subscriptions_user_id ON push_subscriptions (user_id);
*/

// Streak length required before reminders are sent
const MIN_STREAK: i32 = 2;

pub fn notification_fairing() -> AdHoc {
    AdHoc::on_liftoff("Streak reminders", |rocket| {
        Box::pin(async move {
            let pool = rocket_db_pools::Database::fetch(rocket)
                .map(|db: &crate::AdminDB| db.0.clone())
                .expect("AdminDB not initialized");
            tokio::spawn(notification_loop(pool));
        })
    })
}

async fn notification_loop(pool: PgPool) {
    // Without a VAPID key we can't send anything, so don't bother running the loop
    let private_key = match env::var("VAPID_PRIVATE_KEY") {
        Ok(key) => key,
        Err(_) => {
            eprintln!("VAPID_PRIVATE_KEY not set, streak reminders are disabled");
            return;
        }
    };
    let signature_builder = match VapidSignatureBuilder::from_base64_no_sub(&private_key) {
        Ok(builder) => builder,
        Err(e) => {
            eprintln!("Error parsing VAPID_PRIVATE_KEY, streak reminders are disabled: {}", e);
            return;
        }
    };
    let subject = env::var("VAPID_SUBJECT").expect("Env var VAPID_SUBJECT not found");
    // The client is reused for all the requests
    let client = HyperWebPushClient::new();
    // Check every 15 minutes by default, but use configurable PUSH_TICK_SECS for testing
    let tick_seconds = env::var("PUSH_TICK_SECS")
        .ok()
        .and_then(|x| x.parse().ok())
        .unwrap_or(900);
    let mut interval = tokio::time::interval(Duration::from_secs(tick_seconds));
    loop {
        interval.tick().await;
        if let Err(e) = process_tick(&pool, &client, &signature_builder, &subject).await {
            eprintln!("Error processing streak reminders: {}", e);
        }
    }
}

async fn process_tick(
    pool: &PgPool,
    client: &HyperWebPushClient,
    signature_builder: &PartialVapidSignatureBuilder,
    subject: &str,
) -> Result<(), Box<dyn Error>> {
    // Delete subscriptions from browsers that haven't opened the quiz page in a long time
    sqlx::query("DELETE FROM push_subscriptions WHERE updated_at < NOW() - INTERVAL '90 days'")
        .execute(pool).await?;

    let rows = sqlx::query(
        "SELECT * FROM push_subscriptions WHERE current_streak >= $1 AND last_active_date IS NOT NULL",
    )
    .bind(MIN_STREAK)
    .fetch_all(pool).await?;

    // Find the freshest streak state for each user, in case one of their devices hasn't
    // synced since the streak was last extended
    let mut freshest: HashMap<Uuid, NaiveDate> = HashMap::new();
    for row in &rows {
        let last_active: NaiveDate = row.get("last_active_date");
        let entry = freshest.entry(row.get("user_id")).or_insert(last_active);
        if last_active > *entry {
            *entry = last_active;
        }
    }

    for row in &rows {
        let tz: Tz = match row.get::<String, _>("timezone").parse() {
            Ok(tz) => tz,
            Err(_) => continue,
        };
        let local = Utc::now().with_timezone(&tz);
        let today = local.date_naive();
        // Only send between 19:00 and 19:59 local time
        // (.format is used because sqlx doesn't re-export chrono's Timelike trait for .hour())
        if local.format("%H").to_string() != "19" {
            continue;
        }
        let yesterday = match today.pred_opt() {
            Some(date) => date,
            None => continue,
        };
        // The streak is only at risk if the user was last active yesterday: activity today
        // means it's already maintained, and a longer gap means it's already broken
        if freshest[&row.get::<Uuid, _>("user_id")] != yesterday {
            continue;
        }
        // Don't notify the same device twice in one day
        if row.get::<Option<NaiveDate>, _>("last_notified_date") == Some(today) {
            continue;
        }

        let subscription = SubscriptionInfo::new(
            row.get::<String, _>("endpoint"),
            row.get::<String, _>("p256dh"),
            row.get::<String, _>("auth"),
        );
        let id: i32 = row.get("id");
        let result = send_reminder(
            client,
            signature_builder,
            subject,
            &subscription,
            row.get("current_streak"),
        ).await;
        match result {
            Ok(_) => {
                sqlx::query("UPDATE push_subscriptions SET last_notified_date = $1 WHERE id = $2")
                    .bind(today)
                    .bind(id)
                    .execute(pool).await?;
            }
            // The subscription no longer exists, so delete it
            Err(WebPushError::EndpointNotFound(_)) | Err(WebPushError::EndpointNotValid(_)) => {
                sqlx::query("DELETE FROM push_subscriptions WHERE id = $1")
                    .bind(id)
                    .execute(pool).await?;
            }
            // Other errors might be temporary, so keep the subscription for the next tick
            Err(e) => eprintln!("Error sending push notification: {}", e),
        }
    }

    Ok(())
}

async fn send_reminder(
    client: &HyperWebPushClient,
    signature_builder: &PartialVapidSignatureBuilder,
    subject: &str,
    subscription: &SubscriptionInfo,
    current_streak: i32,
) -> Result<(), WebPushError> {
    let mut vapid = signature_builder.clone().add_sub_info(subscription);
    // Some push services reject VAPID tokens that don't have a subject
    vapid.add_claim("sub", subject);
    let payload = serde_json::json!({
        "title": "Sakubun",
        "body": format!(
            "Don't lose your {}-day streak! Do a few quiz questions to keep it going.",
            current_streak,
        ),
        "url": "/quiz",
    })
    .to_string();
    let mut builder = WebPushMessageBuilder::new(subscription);
    builder.set_payload(ContentEncoding::Aes128Gcm, payload.as_bytes());
    builder.set_vapid_signature(vapid.build()?);
    // A reminder that can't be delivered before the day is over shouldn't be delivered at all
    builder.set_ttl(4 * 60 * 60);
    builder.set_urgency(Urgency::High);
    client.send(builder.build()?).await
}
