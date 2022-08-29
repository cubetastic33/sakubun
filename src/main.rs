use argon2::{
    password_hash::{PasswordHash, PasswordVerifier},
    Argon2,
};
use db::Db;
use rocket::{
    fairing::AdHoc,
    form::Form,
    fs::{relative, FileServer, TempFile},
    get,
    http::{ContentType, Cookie, CookieJar},
    launch, post,
    response::status::Custom,
    routes,
    serde::json::Json,
    tokio::fs,
    FromForm,
};
use rocket_db_pools::Connection;
use rocket_dyn_templates::Template;
use serde::Serialize;
use std::{collections::HashMap, env};
use uuid::Uuid;

mod actions;
mod db;

use actions::*;

#[derive(FromForm)]
pub struct QuizSettings {
    min: usize,
    max: usize,
    known_kanji: String,
}

#[derive(FromForm)]
pub struct Report {
    sentence_id: i32,
    report_type: String,
    // also uses bytes because 500 is db limit
    #[field(validate = len(..=500))]
    suggested: Option<String>,
    #[field(validate = len(..=500))]
    comment: Option<String>,
}

#[derive(FromForm)]
struct SingleField {
    value: String,
}

#[derive(FromForm)]
pub struct OrderedImport {
    number: usize,
    method: String,
}

#[derive(FromForm)]
pub struct AnkiImport<'f> {
    only_learnt: bool,
    #[field(validate = ext(ContentType::ZIP))]
    file: TempFile<'f>,
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
}

#[derive(Serialize)]
struct AdminContext {
    theme: String,
    page: String,
    reports: Vec<AdminReport>,
    overrides: Vec<AdminOverride>,
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
    let current_date = chrono::Utc::now().date();
    context.insert("year", current_date.format("%Y").to_string());
    context.insert("page", page.to_owned());
    context
}

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

#[get("/admin")]
async fn get_admin(db: Connection<Db>, cookies: &CookieJar<'_>) -> Template {
    let mut page = String::from("admin_signin");
    if let Some(hash) = cookies.get_private("admin_hash") {
        if hash.value() == env::var("ADMIN_HASH").unwrap() {
            page = String::from("admin");
        }
    }
    let (reports, overrides) = get_admin_stuff(db).await;
    Template::render(
        page.clone(),
        AdminContext {
            theme: String::from(match cookies.get("theme") {
                Some(cookie) => cookie.value(),
                None => "system",
            }),
            page,
            reports,
            overrides,
        },
    )
}

#[post("/sentences", data = "<quiz_settings>")]
fn post_sentences(db: Connection<Db>, quiz_settings: Form<QuizSettings>) -> String {
    get_sentences(db, quiz_settings)
        .unwrap()
        .iter()
        .map(|x| x.join("~"))
        .collect::<Vec<_>>()
        .join("|")
}

#[post("/report", data = "<report>")]
async fn post_report(db: Connection<Db>, report: Form<Report>) -> String {
    // TODO: inline
    save_report(db, report).await
}

#[post("/import_anki", data = "<import_settings>")]
async fn post_import_anki(
    cont_type: &ContentType,
    mut import_settings: Form<AnkiImport<'_>>,
) -> Result<String, Custom<String>> {
    let path = Uuid::new_v4().to_string();
    import_settings.file.persist_to(&path).await.unwrap();
    extract_kanji_from_anki_deck(&path, import_settings.only_learnt);
    fs::remove_file(path).await;
    Ok("success".to_owned())
}

// TODO: unify into heirarchical api

#[post("/import_wanikani_api", data = "<api_key>")]
fn post_import_wanikani_api(api_key: Form<SingleField>) -> Result<String, Custom<String>> {
    kanji_from_wanikani(&api_key.value)
}

#[post("/import_wanikani", data = "<import_settings>")]
fn post_import_wanikani(import_settings: Form<OrderedImport>) -> Result<String, Custom<String>> {
    kanji_in_order(KanjiOrder::WaniKani, import_settings)
}

#[post("/import_rtk", data = "<import_settings>")]
fn post_import_rtk(import_settings: Form<OrderedImport>) -> Result<String, Custom<String>> {
    kanji_in_order(KanjiOrder::RTK, import_settings)
}

#[post("/import_jlpt", data = "<import_settings>")]
fn post_import_jlpt(import_settings: Form<OrderedImport>) -> Result<String, Custom<String>> {
    kanji_in_order(KanjiOrder::JLPT, import_settings)
}

#[post("/import_kanken", data = "<import_settings>")]
fn post_import_kanken(import_settings: Form<OrderedImport>) -> Result<String, Custom<String>> {
    kanji_in_order(KanjiOrder::Kanken, import_settings)
}

#[post("/essay", data = "<quiz_settings>")]
fn post_essay(db: Connection<Db>, quiz_settings: Form<QuizSettings>) -> Json<Vec<[String; 4]>> {
    // TODO: do this in a separate thread
    Json(generate_essay(db, quiz_settings))
}

#[post("/admin_signin", data = "<password>")]
fn post_admin_signin(password: Form<SingleField>, mut cookies: &CookieJar<'_>) -> String {
    let argon2 = Argon2::default();
    let admin_hash = env::var("ADMIN_HASH").unwrap();
    let parsed_hash = PasswordHash::new(&admin_hash).unwrap();
    if argon2
        .verify_password(password.value.as_bytes(), &parsed_hash)
        .is_ok()
    {
        cookies.add_private(Cookie::new("admin_hash", admin_hash));
        String::from("success")
    } else {
        String::from("error")
    }
}

#[post("/delete_report", data = "<report_id>")]
async fn post_delete_report(
    db: Connection<Db>,
    report_id: Form<SingleField>,
    cookies: &CookieJar<'_>,
) -> String {
    if let Some(hash) = cookies.get_private("admin_hash") {
        if hash.value() == env::var("ADMIN_HASH").unwrap() {
            return delete_from_table(
                db,
                String::from("reports"),
                report_id.value.parse().unwrap(),
            )
            .await;
        }
    }
    String::from("Error: not signed in")
}

#[post("/add_override", data = "<override_details>")]
async fn post_add_override(
    db: Connection<Db>,
    override_details: Form<AddOverride>,
    cookies: &CookieJar<'_>,
) -> String {
    if let Some(hash) = cookies.get_private("admin_hash") {
        if hash.value() == env::var("ADMIN_HASH").unwrap() {
            return add_override(db, override_details).await;
        }
    }
    String::from("Error: not signed in")
}

#[post("/delete_override", data = "<override_id>")]
async fn post_delete_override(
    db: Connection<Db>,
    override_id: Form<SingleField>,
    cookies: &CookieJar<'_>,
) -> String {
    if let Some(hash) = cookies.get_private("admin_hash") {
        if hash.value() == env::var("ADMIN_HASH").unwrap() {
            return delete_from_table(
                db,
                String::from("overrides"),
                override_id.value.parse().unwrap(),
            )
            .await;
        }
    }
    String::from("Error: not signed in")
}

#[post("/edit_override", data = "<override_details>")]
async fn post_edit_override(
    db: Connection<Db>,
    override_details: Form<EditOverride>,
    cookies: &CookieJar<'_>,
) -> String {
    if let Some(hash) = cookies.get_private("admin_hash") {
        if hash.value() == env::var("ADMIN_HASH").unwrap() {
            return edit_override(db, override_details).await;
        }
    }
    String::from("Error: not signed in")
}

#[post("/admin_signout")]
fn post_admin_signout(mut cookies: &CookieJar<'_>) -> String {
    cookies.remove_private(Cookie::named("admin_hash"));
    String::from("success")
}

#[launch]
fn rocket() -> _ {
    rocket::build()
        .attach(db::stage())
        .mount(
            "/",
            routes![
                get_index,
                get_known_kanji,
                get_quiz,
                get_essay,
                get_custom_text,
                get_offline,
                get_admin,
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
                post_delete_override,
                post_edit_override,
            ],
        )
        .mount("/", FileServer::from(relative!("static")).rank(20))
        .attach(Template::fairing())
}
