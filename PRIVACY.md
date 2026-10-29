# Vacha Privacy Policy

Last updated: 2026-10-29

**Nova Globen AB** (Sweden) is the data controller for the Vacha application
and the nova-globen.se/products/vacha services. Contact: info@nova-globen.se.

## The application

Vacha is designed to not phone home:

- **No telemetry.** The application collects no usage analytics and sends
  no crash reports or product telemetry to Nova Globen AB or anyone else.
- **No accounts.** The application has no sign-in and stores no identity.
- **Local data stays local.** Settings, keybindings and editor session
  state are stored on your computer, under `%APPDATA%\Vacha` and the `.vacha`
  data folder.
- **Update check.** The only network request the application makes on its
  own is a check for new versions, at most once a day: a plain HTTPS GET for
  <https://nova-globen.se/products/vacha/releases.json>. No identifier or other data
  is attached to it. Like any web request, it reveals your IP address and the
  requested URL to the servers that answer it (see "Hosting" below). We do
  not use it to identify or track you.
  The Microsoft Store version makes no such check: the Store updates it.
- **Downloads.** The installer and the zip are downloaded from GitHub
  (GitHub, Inc.), and the Store version from Microsoft. Like any web host,
  they see your IP address and what you download; their own privacy
  statements apply.
- **Everything else is your action**: files you open are read from your
  computer, and links you click open in your browser.

## The website, contact form, support agreements and donations

- **Contact form and bug reports.** When you write to us through the
  Nova Globen contact form or by email, we process what you send (typically
  your name, email address and message) to answer you and fix the problem
  (legal basis: legitimate interest, GDPR Art. 6(1)(f)). The website does
  not store form messages: each one is delivered as an email to
  info@nova-globen.se, and we delete it from our inbox when it is no longer
  needed, at the latest two years after the conversation ends. To stop
  spam, the form sends your IP address to Cloudflare Turnstile, and the
  website holds it in memory for at most 10 minutes to limit repeated
  posts; it is not written to disk.
- **Support agreements.** When a company makes a support agreement with us
  we process the company name, contact names and emails, and agreement and
  invoice records, to deliver the support, issue invoices and meet
  bookkeeping obligations (legal bases: contract and legal obligation, GDPR
  Art. 6(1)(b) and (c)). We keep them while the agreement runs and then as
  long as Swedish accounting law requires (currently seven years).
- **Donations.** The donation service named on nova-globen.se/products/vacha, once there
  is one, handles the payment; we receive the donor details that service
  passes on and keep them only as long as accounting law requires.
- We do not sell personal data, and we use no advertising or third-party
  analytics trackers.

## Hosting

The website and the update file are served from Nova Globen AB's own servers
in Sweden. Requests reach them through **Cloudflare**, which acts as our
processor: it sees your IP address and the request in order to deliver it
and protect the site, and the contact form uses Cloudflare Turnstile to keep
out spam. Our web server keeps access logs (IP address, time, requested URL,
browser) only in a small rotating log that is overwritten within days; the
logs are not copied elsewhere or backed up. The website application keeps
no visitor tracking or page-view log; its error and security event log can
include the IP address and URL of a request that caused an error, and
entries are deleted after 30 days. Processors that handle personal
data on our behalf do so under data processing agreements.

## Your rights

Under the GDPR you may request access, rectification, erasure, restriction
or portability of your personal data, and object to processing based on
legitimate interest. Contact info@nova-globen.se. You may also complain to
a supervisory authority; in Sweden that is the Swedish Authority for Privacy
Protection (IMY, imy.se).

## Changes

We announce changes to this policy at nova-globen.se/products/vacha and update the
date above.
