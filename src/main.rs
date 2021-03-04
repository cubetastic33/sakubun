#![feature(proc_macro_hygiene, decl_macro)]

#[macro_use]
extern crate rocket;
#[macro_use]
extern crate serde_derive;

use dotenv::dotenv;
use io::Read;
use multipart::server::Multipart;
use postgres::{Client, NoTls};
use rocket::{
    http::{ContentType, Cookies, Status},
    request::Form,
    response::status::Custom,
    Config, Data, State,
};
use rocket_contrib::{serve::StaticFiles, templates::Template};
use std::{
    collections::HashMap,
    env,
    io::{self, Cursor},
    sync::Mutex,
};

mod actions;

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
    suggested: Option<String>,
    comment: Option<String>,
}

#[derive(FromForm)]
struct WaniKaniAPIKey {
    key: String,
}

#[derive(FromForm)]
pub struct OrderedImport {
    number: usize,
    method: String,
}

#[derive(Serialize)]
pub struct AdminReport {
    question: String,
    translation: String,
    report_type: String,
    suggested: Option<String>,
    comment: Option<String>,
    reported_at: String,
}

#[derive(Serialize)]
struct AdminContext {
    theme: String,
    page: String,
    reports: Vec<AdminReport>,
}

fn create_context<'a>(cookies: &'a Cookies, page: &'a str) -> HashMap<&'a str, &'a str> {
    let mut context = HashMap::new();
    context.insert(
        "theme",
        match cookies.get("theme") {
            Some(cookie) => cookie.value(),
            None => "system",
        },
    );
    context.insert("page", page);
    context
}

#[get("/")]
fn get_index(cookies: Cookies) -> Template {
    Template::render("index", create_context(&cookies, "/"))
}

#[get("/known_kanji")]
fn get_known_kanji(cookies: Cookies) -> Template {
    Template::render("known_kanji", create_context(&cookies, "known_kanji"))
}

#[get("/quiz")]
fn get_quiz(cookies: Cookies) -> Template {
    Template::render("quiz", create_context(&cookies, "quiz"))
}

#[get("/custom_text")]
fn get_custom_text(cookies: Cookies) -> Template {
    Template::render("custom_text", create_context(&cookies, "custom_text"))
}

#[get("/offline")]
fn get_offline(cookies: Cookies) -> Template {
    Template::render("offline", create_context(&cookies, "offline"))
}

#[get("/admin")]
fn get_admin(client: State<Mutex<Client>>, cookies: Cookies) -> Template {
    Template::render(
        "admin",
        AdminContext {
            theme: String::from(match cookies.get("theme") {
                Some(cookie) => cookie.value(),
                None => "system",
            }),
            page: String::from("admin"),
            reports: get_reports(&mut client.lock().unwrap()),
        },
    )
}

#[post("/sentences", data = "<quiz_settings>")]
fn post_sentences(client: State<Mutex<Client>>, quiz_settings: Form<QuizSettings>) -> String {
    get_sentences(&mut client.lock().unwrap(), quiz_settings)
        .unwrap()
        .iter()
        .map(|x| x.join(";"))
        .collect::<Vec<_>>()
        .join("|")
}

#[post("/report", data = "<report>")]
fn post_report(client: State<Mutex<Client>>, report: Form<Report>) -> String {
    save_report(&mut client.lock().unwrap(), report)
}

#[post("/import_anki", data = "<data>")]
fn post_import_anki(cont_type: &ContentType, data: Data) -> Result<String, Custom<String>> {
    // Validate data
    if !cont_type.is_form_data() {
        return Err(Custom(
            Status::BadRequest,
            "Content-Type not multipart/form-data".into(),
        ));
    }

    let (_, boundary) = cont_type
        .params()
        .find(|&(k, _)| k == "boundary")
        .ok_or_else(|| {
            Custom(
                Status::BadRequest,
                "`Content-Type: multipart/form-data` boundary param not provided".into(),
            )
        })?;

    // Read data
    let mut only_learnt = String::new();
    let mut buf = Vec::new();
    let mut form_data = Multipart::with_body(data.open(), boundary);
    form_data
        .read_entry()
        .unwrap()
        .unwrap()
        .data
        .read_to_string(&mut only_learnt)
        .unwrap();
    form_data
        .read_entry()
        .unwrap()
        .unwrap()
        .data
        .read_to_end(&mut buf)
        .unwrap();
    // The maximum allowed file size is 4 MiB
    if buf.len() > 4194304 {
        return Err(Custom(
            Status::PayloadTooLarge,
            String::from("File too large"),
        ));
    }
    extract_kanji_from_anki_deck(Cursor::new(buf), only_learnt == "true")
}

#[post("/import_wanikani_api", data = "<api_key>")]
fn post_import_wanikani_api(api_key: Form<WaniKaniAPIKey>) -> Result<String, Custom<String>> {
    kanji_from_wanikani(&api_key.key)
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

fn configure() -> Config {
    let mut config = Config::active().expect("could not load configuration");
    // Configure Rocket to use the PORT env var or fall back to 8000
    let port = if let Ok(port_str) = env::var("PORT") {
        port_str.parse().expect("could not parse PORT")
    } else {
        8000
    };
    config.set_port(port);
    config
}

fn rocket() -> rocket::Rocket {
    rocket::custom(configure())
        .mount(
            "/",
            routes![
                get_index,
                get_known_kanji,
                get_quiz,
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
            ],
        )
        .mount("/styles", StaticFiles::from("static/styles"))
        .mount("/scripts", StaticFiles::from("static/scripts"))
        .mount("/fonts", StaticFiles::from("static/fonts"))
        .mount("/dict", StaticFiles::from("static/dict"))
        .mount("/", StaticFiles::from("static/pwa").rank(20))
        .attach(Template::fairing())
}

fn main() {
    dotenv().ok();
    let client = Client::connect(&env::var("DATABASE_URL").unwrap(), NoTls).unwrap();
    rocket().manage(Mutex::new(client)).launch();
}
