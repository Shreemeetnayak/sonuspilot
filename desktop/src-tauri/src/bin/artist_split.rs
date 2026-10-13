use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

pub fn get_split(artist_id: &str) -> &'static str {
    let mut s = DefaultHasher::new();
    artist_id.hash(&mut s);
    let h = s.finish() % 100;
    if h < 80 { "train" } else if h < 90 { "val" } else { "test" }
}
