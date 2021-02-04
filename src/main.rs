#![feature(proc_macro_hygiene, decl_macro)]

#[macro_use] extern crate rocket;

use rocket::Config;
use rocket_contrib::{serve::StaticFiles, templates::Template};
use std::env;
use std::collections::HashMap;

mod sentences;

use sentences::*;

#[get("/")]
fn index() -> Template {
    let context: HashMap<String, String> = HashMap::new();
    Template::render("index", context)
}

#[post("/sentences")]
fn post_sentences() -> String {
    get_sentences().unwrap().iter().map(|x| x.join(";")).collect::<Vec<_>>().join("|")
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
            routes![index, post_sentences],
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
