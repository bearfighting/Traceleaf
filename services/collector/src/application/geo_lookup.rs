use std::net::IpAddr;

use crate::domain::geo::GeoEnrichment;

pub trait GeoResolver: Send + Sync {
    fn lookup(&self, ip: Option<IpAddr>) -> GeoEnrichment;
}
