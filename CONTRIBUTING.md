# Contributing to Vacha

Thanks for your interest in Vacha!

## Reporting issues

Report bugs and feature requests through the Nova Globen contact form at
<https://nova-globen.se/products/vacha/issues>, or by email to info@nova-globen.se.
Please include the Vacha version (Help > About), your Windows version, and
steps to reproduce. Report security problems as described in
[SECURITY.md](SECURITY.md).

## Contributing code

Vacha is open source under the GNU General Public License, version 3 or
later ([LICENSE.txt](LICENSE.txt)). Pull requests are welcome on the public
repository. By submitting a contribution you agree that it is licensed
under the same license (GPL-3.0-or-later). Keep changes in the spirit of
Vacha: a fast editor for files, not an IDE. Ideas and feedback are always
welcome through the contact form too.

For maintainers: validate changes with `npm run typecheck-client` (never
`npm run compile`), and package with `.\scripts\release.ps1`.

## Upstream

Vacha is based on [Code - OSS](https://github.com/microsoft/vscode).
Improvements that are not Vacha-specific are best contributed upstream.
