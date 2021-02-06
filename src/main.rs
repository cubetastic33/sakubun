#![feature(proc_macro_hygiene, decl_macro)]

#[macro_use] extern crate rocket;

use rocket::{request::Form, Config};
use rocket_contrib::{serve::StaticFiles, templates::Template};
use std::env;
use std::collections::HashMap;

mod sentences;

use sentences::*;

#[derive(FromForm)]
pub struct QuizSettings {
    min: usize,
    max: usize,
    known_kanji: String,
}

#[get("/")]
fn get_index() -> Template {
    let mut context = HashMap::new();
    context.insert("page", "/");
    Template::render("index", context)
}

#[get("/known_kanji")]
fn get_known_kanji() -> Template {
    let mut context = HashMap::new();
    context.insert("page", "known_kanji");
    Template::render("known_kanji", context)
}

#[get("/quiz")]
fn get_quiz() -> Template {
    let mut context = HashMap::new();
    context.insert("page", "quiz");
    Template::render("quiz", context)
}

#[get("/custom_text")]
fn get_custom_text() -> Template {
    let mut context = HashMap::new();
    context.insert("page", "custom_text");
    Template::render("custom_text", context)
}

#[post("/sentences", data = "<quiz_settings>")]
fn post_sentences(quiz_settings: Form<QuizSettings>) -> String {
    get_sentences(quiz_settings).unwrap().iter().map(|x| x.join(";")).collect::<Vec<_>>().join("|")
}

fn configure() -> Config {
    let mut config = Config::active().expect("could not load configuration");
    /*config
        .set_secret_key(env::var("SECRET_KEY").unwrap())
        .unwrap();*/
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
            routes![get_index, get_known_kanji, get_quiz, get_custom_text, post_sentences],
        )
        .mount("/styles", StaticFiles::from("static/styles"))
        .mount("/scripts", StaticFiles::from("static/scripts"))
        .mount("/fonts", StaticFiles::from("static/fonts"))
        .mount("/dict", StaticFiles::from("static/dict"))
        .mount("/", StaticFiles::from("static/icons").rank(20))
        .attach(Template::fairing())
}

fn main() {
    rocket().launch();
}
