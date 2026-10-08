use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

pub const DEFAULT_LIMIT: u64 = 600;

#[derive(Clone)]
pub struct RateLimiter {
    limit: u64,
    windows: Arc<Mutex<HashMap<(String, String), Window>>>,
    clock: Arc<dyn Fn() -> u64 + Send + Sync>,
}

#[derive(Clone, Copy)]
struct Window {
    minute: u64,
    requests: u64,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self::with_limit(DEFAULT_LIMIT)
    }

    pub fn with_limit(limit: u64) -> Self {
        Self::with_clock(limit, || {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock must be after Unix epoch")
                .as_secs()
                / 60
        })
    }

    pub fn with_clock<F>(limit: u64, clock: F) -> Self
    where
        F: Fn() -> u64 + Send + Sync + 'static,
    {
        assert!(limit > 0, "rate limit must be positive");
        Self {
            limit,
            windows: Arc::new(Mutex::new(HashMap::new())),
            clock: Arc::new(clock),
        }
    }

    pub fn try_acquire(&self, site_id: &str, origin: &str) -> bool {
        self.try_acquire_with_limit(site_id, origin, self.limit)
    }

    pub fn try_acquire_with_limit(&self, site_id: &str, origin: &str, limit: u64) -> bool {
        let minute = (self.clock)();
        let mut windows = self.windows.lock().expect("rate limiter mutex poisoned");
        let window = windows
            .entry((site_id.to_owned(), origin.to_owned()))
            .or_insert(Window {
                minute,
                requests: 0,
            });

        if window.minute != minute {
            window.minute = minute;
            window.requests = 0;
        }

        if window.requests >= limit {
            return false;
        }

        window.requests += 1;
        true
    }
}

impl Default for RateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    };

    use super::{DEFAULT_LIMIT, RateLimiter};

    #[test]
    fn production_default_limit_is_600_requests_per_minute() {
        assert_eq!(DEFAULT_LIMIT, 600);
    }

    #[test]
    fn enforces_limit_per_site_and_origin_until_window_changes() {
        let minute = Arc::new(AtomicU64::new(10));
        let clock_minute = Arc::clone(&minute);
        let limiter = RateLimiter::with_clock(2, move || clock_minute.load(Ordering::Relaxed));

        assert!(limiter.try_acquire("site_example", "https://example.com"));
        assert!(limiter.try_acquire("site_example", "https://example.com"));
        assert!(!limiter.try_acquire("site_example", "https://example.com"));
        assert!(limiter.try_acquire("site_other", "https://example.com"));
        assert!(limiter.try_acquire("site_example", "https://other.example"));

        minute.store(11, Ordering::Relaxed);
        assert!(limiter.try_acquire("site_example", "https://example.com"));
    }
}
