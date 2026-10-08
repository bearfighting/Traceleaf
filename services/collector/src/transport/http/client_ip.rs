use std::net::IpAddr;

use ipnet::IpNet;

pub fn client_ip(
    peer: Option<IpAddr>,
    forwarded_for: Option<&str>,
    trusted_proxies: &[IpNet],
) -> Option<IpAddr> {
    let peer = peer?;
    if !trusted_proxies
        .iter()
        .any(|network| network.contains(&peer))
    {
        return Some(peer);
    }

    let forwarded_for = forwarded_for?;
    let chain = forwarded_for
        .split(',')
        .map(str::trim)
        .map(str::parse::<IpAddr>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;

    chain
        .into_iter()
        .rev()
        .find(|ip| !trusted_proxies.iter().any(|network| network.contains(ip)))
}

#[cfg(test)]
mod tests {
    use super::client_ip;
    use ipnet::IpNet;
    use std::net::IpAddr;

    fn ip(value: &str) -> IpAddr {
        value.parse().unwrap()
    }
    fn networks(values: &[&str]) -> Vec<IpNet> {
        values.iter().map(|value| value.parse().unwrap()).collect()
    }

    #[test]
    fn trusts_forwarded_chain_only_when_peer_is_trusted() {
        let trusted = networks(&["10.0.0.0/8", "2001:db8::/32"]);
        assert_eq!(
            client_ip(Some(ip("203.0.113.7")), Some("198.51.100.4"), &trusted),
            Some(ip("203.0.113.7"))
        );
        assert_eq!(
            client_ip(
                Some(ip("10.0.0.2")),
                Some("198.51.100.4, 10.0.0.1"),
                &trusted
            ),
            Some(ip("198.51.100.4"))
        );
        assert_eq!(
            client_ip(Some(ip("10.0.0.2")), Some("invalid"), &trusted),
            None
        );
        assert_eq!(
            client_ip(Some(ip("10.0.0.2")), Some("10.0.0.1, 10.0.0.3"), &trusted),
            None
        );
        assert_eq!(client_ip(None, Some("198.51.100.1"), &trusted), None);
        assert_eq!(
            client_ip(
                Some(ip("2001:db8::2")),
                Some("2001:4860::7, 10.0.0.4"),
                &trusted
            ),
            Some(ip("2001:4860::7"))
        );
    }
}
