#![feature(proc_macro_hygiene, decl_macro)]

#[macro_use] extern crate rocket;

use io::Read;
use multipart::server::Multipart;
use rocket::{http::{ContentType, Status}, request::Form, response::status::Custom, Config, Data};
use rocket_contrib::{serve::StaticFiles, templates::Template};
use std::env;
use std::collections::HashMap;
use std::io::{self, Cursor};

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

#[post("/import_anki", data = "<data>")]
fn post_import_anki(cont_type: &ContentType, data: Data) -> Result<String, Custom<String>> {
    // this and the next check can be implemented as a request guard but it seems like just
    // more boilerplate than necessary
    if !cont_type.is_form_data() {
        return Err(Custom(
            Status::BadRequest,
            "Content-Type not multipart/form-data".into()
        ));
    }

    let (_, boundary) = cont_type.params().find(|&(k, _)| k == "boundary").ok_or_else(
            || Custom(
                Status::BadRequest,
                "`Content-Type: multipart/form-data` boundary param not provided".into()
            )
        )?;

    let mut buf = Vec::new();
    match Multipart::with_body(data.open(), boundary).into_entry().unwrap().data.read_to_end(&mut buf) {
        // TODO check for including unlearnt kanji
        Ok(_) => extract_kanji_from_anki_deck(Cursor::new(buf), true),
        Err(_) => Err(Custom(Status::InternalServerError, String::from("Failed to read file"))),
    }
}

/*fn process_upload(boundary: &str, data: Data) -> io::Result<Vec<u8>> {
   let mut out = Vec::new();

   Multipart::with_body(data.open(), boundary).into_entry().unwrap();

    // saves all fields, any field longer than 10kB goes to a temporary directory
    // Entries could implement FromData though that would give zero control over
    // how the files are saved; Multipart would be a good impl candidate though
    match Multipart::with_body(data.open(), boundary).save().temp() {
        Full(entries) => process_entries(entries, &mut out)?,
        Partial(partial, reason) => {
            writeln!(out, "Request partially processed: {:?}", reason)?;
            if let Some(field) = partial.partial {
                writeln!(out, "Stopped on field: {:?}", field.source.headers)?;
            }

            process_entries(partial.entries, &mut out)?
        },
        Error(e) => return Err(e),
    }

    Ok(out)
}

fn process_entries(entries: Entries, mut out: &mut Vec<u8>) -> io::Result<()> {
    /*{
        let stdout = io::stdout();
        let tee = StdoutTee::new(&mut out, &stdout);
        entries.write_debug(tee)?;
    }*/
    entries.fields

    writeln!(out, "Entries processed")
}*/

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
            routes![
                get_index,
                get_known_kanji,
                get_quiz,
                get_custom_text,
                post_sentences,
                post_import_anki,
            ],
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
