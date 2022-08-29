use log::error;
use rocket::{fairing, fairing::AdHoc, Build, Rocket};
use rocket_db_pools::{sqlx, Database};

#[derive(Database)]
#[database("fixes")]
pub struct Db(sqlx::PgPool);

pub type Result<T, E = rocket::response::Debug<sqlx::Error>> = std::result::Result<T, E>;

pub async fn run_migrations(rocket: Rocket<Build>) -> fairing::Result {
    match Db::fetch(&rocket) {
        Some(db) => match sqlx::migrate!().run(&**db).await {
            Ok(_) => Ok(rocket),
            Err(e) => {
                error!("Failed to initialize SQLx database: {}", e);
                Err(rocket)
            }
        },
        None => Err(rocket),
    }
}

pub fn stage() -> AdHoc {
    AdHoc::on_ignite("SQLx Stage", |rocket| async {
        rocket
            .attach(Db::init())
            .attach(AdHoc::try_on_ignite("SQLx Migrations", run_migrations))
    })
}
