# news.com.au Word Tracker

This public dashboard tracks visible words from https://www.news.com.au/.

It shows:

- an all-time word cloud
- a daily trend chart for `Bombshell`, `Shocking`, and `Explosive`

## GitHub Pages setup

1. Upload these files to the root of your GitHub repository.
2. In GitHub, go to `Settings > Pages`.
3. Set `Build and deployment` to `GitHub Actions`.
4. Go to `Actions`, choose `Update news word tracker`, and run it once.

The workflow runs every day at 8:00 AM Australia/Brisbane time.
