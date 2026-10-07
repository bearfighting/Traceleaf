//! PostgreSQL queries grouped by the data domains they read and write.

pub(crate) mod definitions;
pub(crate) mod events;
pub(crate) mod facts;
pub(crate) mod generations;
pub(crate) mod page_views;
pub(crate) mod rebuild_queue;
pub(crate) mod site_lock;
pub(crate) mod watermarks;
