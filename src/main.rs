#[macro_use]
extern crate rocket;

use ::sqlx::types::chrono;
use dotenv::dotenv;
use rocket::{
    data::{Limits, ToByteUnit},
    form::Form,
    fs::{FileServer, TempFile},
    http::{CookieJar, Status},
    serde::{json::Json, Serialize},
    tokio::fs,
};
use rocket_db_pools::{sqlx, Connection, Database};
use rocket_dyn_templates::Template;
use argon2::{password_hash::{PasswordHash, PasswordVerifier}, Argon2};
use std::{collections::HashMap, env, fmt::Display};

mod actions;
mod admin;
mod kanji_import;

use actions::*;
use admin::*;
use kanji_import::*;

type ErrResponse = (Status, String);

#[derive(FromForm)]
pub struct QuizSettings {
    min: usize,
    max: usize,
    known_kanji: String,
    known_priority_kanji: String,
}

#[derive(FromForm)]
pub struct Report {
    sentence_id: i32,
    report_type: String,
    suggested: Option<String>,
    comment: Option<String>,
}

#[derive(FromForm)]
struct SingleField {
    value: String,
}

#[derive(FromForm)]
pub struct AnkiImport<'r> {
    only_learnt: bool,
    file: TempFile<'r>,
}

#[derive(FromForm)]
pub struct OrderedImport {
    number: usize,
    method: String,
}

#[derive(FromForm)]
pub struct AddOverride {
    report_id: i32,
    question: String,
    translation: String,
    reading: String,
    additional_reading: Option<String>,
}

#[derive(FromForm)]
pub struct EditOverride {
    override_id: i32,
    value: String,
    primary_value: bool,
}

#[derive(Serialize)]
pub struct AdminReport {
    report_id: i32,
    sentence_id: i32,
    question: String,
    translation: String,
    readings: Vec<String>,
    report_type: String,
    suggested: Option<String>,
    comment: Option<String>,
    reported_at: String,
}

#[derive(Serialize)]
pub struct AdminOverride {
    override_id: i32,
    sentence_id: i32,
    question: String,
    translation: String,
    reading: String,
    override_type: String,
    value: String,
    primary_value: bool,
    overridden_at: String,
    reported_at: Option<String>,
}

#[derive(Serialize)]
struct AdminContext {
    theme: String,
    page: String,
    num_rejected: i64,
    num_pending: i64,
    num_overrides: i64,
    reports: Vec<AdminReport>,
    overrides: Vec<AdminOverride>,
}

// Trait to provide shorthand that converts errors into a status returnable from a route handler
pub trait FormatError<T> {
    // Designed to be used like failable_call().format_error("Error")?
    fn format_error(self, prefix: &str) -> Result<T, ErrResponse>;

    // Same as format_error but also deletes database files before returning.
    // Meant for use in the anki extraction function
    fn error_cleanup(self, file_name: &str) -> impl std::future::Future<Output = Result<T, ErrResponse>>;
}

impl<T, E: Display> FormatError<T> for Result<T, E> {
    fn format_error(self, prefix: &str) -> Result<T, ErrResponse> {
        self.map_err(|e| {
            // Print the error for debug purposes
            eprintln!("Logging from format_error: {}: {}", prefix, e);
            (Status::InternalServerError, format!("{}: {}", prefix, e))
        })
    }

    async fn error_cleanup(self, file_name: &str) -> Result<T, ErrResponse> {
        match self {
            Ok(x) => Ok(x),
            Err(e) => {
                eprintln!("Logging from cleanup_error: {}", e);
                // Delete the temp db files if they exist
                let _ = fs::remove_file(&format!("{}-shm", file_name)).await;
                let _ = fs::remove_file(&format!("{}-wal", file_name)).await;
                // Delete the database file since we're returning early from an error
                fs::remove_file(file_name).await.format_error("Error deleting anki database file")?;
                Err((Status::InternalServerError, e.to_string()))
            },
        }
    }
}

fn create_context<'a>(cookies: &'a CookieJar, page: &'a str) -> HashMap<&'a str, String> {
    let mut context = HashMap::new();
    context.insert(
        "theme",
        match cookies.get("theme") {
            Some(cookie) => cookie.value().to_owned(),
            None => "system".to_owned(),
        },
    );
    let current_date = chrono::Utc::now().date_naive();
    context.insert("year", current_date.format("%Y").to_string());
    context.insert("page", page.to_owned());
    context
}

#[derive(Database)]
#[database("admindb")]
struct AdminDB(sqlx::PgPool);

#[get("/")]
fn get_index(cookies: &CookieJar<'_>) -> Template {
    Template::render("index", create_context(&cookies, "/"))
}

#[get("/known_kanji")]
fn get_known_kanji(cookies: &CookieJar<'_>) -> Template {
    Template::render("known_kanji", create_context(&cookies, "known_kanji"))
}

#[get("/quiz")]
fn get_quiz(cookies: &CookieJar<'_>) -> Template {
    Template::render("quiz", create_context(&cookies, "quiz"))
}

#[get("/essay")]
fn get_essay(cookies: &CookieJar<'_>) -> Template {
    Template::render("essay", create_context(&cookies, "essay"))
}

#[get("/custom_text")]
fn get_custom_text(cookies: &CookieJar<'_>) -> Template {
    Template::render("custom_text", create_context(&cookies, "custom_text"))
}

#[get("/offline")]
fn get_offline(cookies: &CookieJar<'_>) -> Template {
    Template::render("offline", create_context(&cookies, "offline"))
}

#[get("/signup")]
fn get_signup(cookies: &CookieJar<'_>) -> Template {
    Template::render("signup", create_context(&cookies, "signup"))
}

#[get("/signin")]
fn get_signin(cookies: &CookieJar<'_>) -> Template {
    Template::render("signin", create_context(&cookies, "signin"))
}

#[get("/admin")]
async fn get_admin(
    mut db: Connection<AdminDB>,
    cookies: &CookieJar<'_>,
) -> Result<Template, ErrResponse> {
    let mut page = String::from("admin_signin");
    if let Some(hash) = cookies.get_private("admin_hash") {
        if hash.value() == env::var("ADMIN_HASH").format_error("Error in ADMIN_HASH")? {
            page = String::from("admin");
        }
    }
    let (num_rejected, num_pending, num_overrides, reports, overrides) = get_admin_stuff(&mut **db).await.format_error("Error in get_admin_stuff")?;
    Ok(Template::render(
        page.clone(),
        AdminContext {
            theme: String::from(match cookies.get("theme") {
                Some(cookie) => cookie.value(),
                None => "system",
            }),
            page,
            num_rejected,
            num_pending,
            num_overrides,
            reports,
            overrides,
        },
    ))
}

#[get("/health")]
async fn get_health() -> Result<String, ErrResponse> {
    // Make GET request to healthcheck endpoint
    reqwest::get(env::var("HEALTH_URL").format_error("Error in HEALTH_URL")?).await
        .map_err(|e| (Status::BadGateway, e.to_string()))?;
    Ok(String::from("元気"))
}

#[post("/sentences", data = "<quiz_settings>")]
async fn post_sentences(mut db: Connection<AdminDB>, quiz_settings: Form<QuizSettings>) -> Result<String, ErrResponse> {
    Ok(get_sentences(&mut **db, quiz_settings).await
        .format_error("Error in get_sentences")?
        .iter()
        .map(|x| x.join("~"))
        .collect::<Vec<_>>()
        .join("|"))
}

#[post("/report", data = "<report>")]
async fn post_report(mut db: Connection<AdminDB>, report: Form<Report>) -> Result<String, ErrResponse> {
    save_report(&mut **db, report).await
}

#[post("/import_anki", data = "<data>")]
async fn post_import_anki(data: Form<AnkiImport<'_>>) -> Result<String, ErrResponse> {
    extract_kanji_from_anki_deck(&data.file, &data.only_learnt).await
}

#[post("/import_wanikani_api", data = "<api_key>")]
async fn post_import_wanikani_api(api_key: Form<SingleField>) -> Result<String, ErrResponse> {
    kanji_from_wanikani(&api_key.value).await
}

#[post("/import_wanikani", data = "<import_settings>")]
async fn post_import_wanikani(import_settings: Form<OrderedImport>) -> Result<String, ErrResponse> {
    kanji_in_order(KanjiOrder::WaniKani, import_settings).await
}

#[post("/import_rtk", data = "<import_settings>")]
async fn post_import_rtk(import_settings: Form<OrderedImport>) -> Result<String, ErrResponse> {
    kanji_in_order(KanjiOrder::RTK, import_settings).await
}

#[post("/import_jlpt", data = "<import_settings>")]
async fn post_import_jlpt(import_settings: Form<OrderedImport>) -> Result<String, ErrResponse> {
    kanji_in_order(KanjiOrder::JLPT, import_settings).await
}

#[post("/import_kanken", data = "<import_settings>")]
async fn post_import_kanken(import_settings: Form<OrderedImport>) -> Result<String, ErrResponse> {
    kanji_in_order(KanjiOrder::Kanken, import_settings).await
}

#[post("/essay", data = "<quiz_settings>")]
async fn post_essay(
    mut db: Connection<AdminDB>,
    quiz_settings: Form<QuizSettings>,
) -> Result<Json<Vec<[String; 4]>>, ErrResponse> {
    Ok(Json(generate_essay(&mut **db, quiz_settings).await?))
}

#[post("/admin_signin", data = "<password>")]
fn post_admin_signin(password: Form<SingleField>, cookies: &CookieJar<'_>) -> Result<String, ErrResponse> {
    let argon2 = Argon2::default();
    let admin_hash = env::var("ADMIN_HASH").format_error("Error in ADMIN_HASH")?;
    let parsed_hash = PasswordHash::new(&admin_hash).format_error("Error parsing admin hash")?;
    if argon2
        .verify_password(password.value.as_bytes(), &parsed_hash)
        .is_ok()
    {
        cookies.add_private(("admin_hash", admin_hash));
        Ok(String::from("success"))
    } else {
        Ok(String::from("error"))
    }
}

#[post("/admin_signout")]
fn post_admin_signout(cookies: &CookieJar<'_>) -> String {
    cookies.remove_private("admin_hash");
    String::from("success")
}

#[post("/delete_report", data = "<report_id>")]
async fn post_delete_report(
    mut db: Connection<AdminDB>,
    report_id: Form<SingleField>,
    cookies: &CookieJar<'_>,
) -> Result<String, ErrResponse> {
    if let Some(hash) = cookies.get_private("admin_hash") {
        if hash.value() == env::var("ADMIN_HASH").format_error("Error in ADMIN_HASH")? {
            return mark_reviewed(
                &mut **db,
                report_id.value.parse().format_error("Error parsing report_id")?,
            ).await;
        }
    }
    Err((Status::Unauthorized, "Error: not signed in".to_string()))
}

#[post("/add_override", data = "<override_details>")]
async fn post_add_override(
    mut db: Connection<AdminDB>,
    override_details: Form<AddOverride>,
    cookies: &CookieJar<'_>,
) -> Result<String, ErrResponse> {
    if let Some(hash) = cookies.get_private("admin_hash") {
        if hash.value() == env::var("ADMIN_HASH").format_error("Error in ADMIN_HASH")? {
            return add_override(&mut **db, override_details).await;
        }
    }
    Err((Status::Unauthorized, "Error: not signed in".to_string()))
}

#[post("/edit_override", data = "<override_details>")]
async fn post_edit_override(
    mut db: Connection<AdminDB>,
    override_details: Form<EditOverride>,
    cookies: &CookieJar<'_>,
) -> Result<String, ErrResponse> {
    if let Some(hash) = cookies.get_private("admin_hash") {
        if hash.value() == env::var("ADMIN_HASH").format_error("Error in ADMIN_HASH")? {
            return edit_override(&mut **db, override_details).await;
        }
    }
    Err((Status::Unauthorized, "Error: not signed in".to_string()))
}

#[post("/delete_override", data = "<override_id>")]
async fn post_delete_override(
    mut db: Connection<AdminDB>,
    override_id: Form<SingleField>,
    cookies: &CookieJar<'_>,
) -> Result<String, ErrResponse> {
    if let Some(hash) = cookies.get_private("admin_hash") {
        if hash.value() == env::var("ADMIN_HASH").format_error("Error in ADMIN_HASH")? {
            return delete_override(
                &mut **db,
                override_id.value.parse().format_error("Error parsing override_id")?,
            ).await;
        }
    }
    Err((Status::Unauthorized, "Error: not signed in".to_string()))
}

#[launch]
fn rocket() -> _ {
    dotenv().ok();
    // Configure Rocket to use the PORT env var or fall back to 8000
    let port = if let Ok(port_str) = env::var("PORT") {
        port_str.parse().expect("could not parse env var PORT")
    } else {
        8000
    };
    let figment = rocket::Config::figment()
        .merge((
            "secret_key",
            env::var("SECRET_KEY").expect("Env var SECRET_KEY not found"),
        ))
        .merge((
            "databases.admindb.url",
            env::var("DATABASE_URL").expect("Env var DATABASE_URL not found"),
        ))
        .merge(("address", env::var("ADDRESS").unwrap_or("127.0.0.1".to_string())))
        .merge(("port", port))
        .merge((
            "limits",
            Limits::default()
                .limit("file", 4.mebibytes())
                .limit("data-form", 5.mebibytes()),
        ));

    rocket::custom(figment)
        .mount("/styles", FileServer::from("static/styles"))
        .mount("/scripts", FileServer::from("static/scripts"))
        .mount("/fonts", FileServer::from("static/fonts"))
        .mount("/dict", FileServer::from("static/dict"))
        .mount("/", FileServer::from("static/pwa").rank(20))
        .mount(
            "/",
            routes![
                get_index,
                get_known_kanji,
                get_quiz,
                get_essay,
                get_custom_text,
                get_offline,
                get_signup,
                get_signin,
                get_admin,
                get_health,
                post_sentences,
                post_report,
                post_import_anki,
                post_import_wanikani_api,
                post_import_wanikani,
                post_import_rtk,
                post_import_jlpt,
                post_import_kanken,
                post_essay,
                post_admin_signin,
                post_admin_signout,
                post_delete_report,
                post_add_override,
                post_edit_override,
                post_delete_override,
            ],
        )
        .attach(Template::fairing())
        .attach(AdminDB::init())
}
