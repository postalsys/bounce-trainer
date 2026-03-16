# CLAUDE.md

## Rules

- Never use emojis in code, comments, or documentation.
- Do not include Claude as a co-contributor in commit messages.
- Use Conventional Commit format for all commit messages.

## Project Overview

Web interface and training pipeline for the [@postalsys/bounce-classifier](https://github.com/postalsys/bounce-classifier) npm package. Allows the community to submit labeled SMTP bounce messages to improve the classifier.

## Architecture

- `web/` - Node.js + Express web app with GitHub OAuth, SQLite storage
- `pipeline/` - Python training pipeline (TensorFlow/Keras)
- `data/` - Community-submitted labeled training data (committed to git)

The bounce-classifier npm package lives in a separate repo. This project produces training data and model files that get copied there.

## Commands

### Web App (web/)

```bash
cd web
npm install
npm run dev       # Development with auto-reload
npm start         # Production
npm test          # Run tests
```

### Training Pipeline (pipeline/)

```bash
cd pipeline
bash retrain.sh   # Full retrain (creates venv, merges data, trains model)
```

Or step by step:
```bash
source venv/bin/activate
python merge_data.py                                    # Merge community + baseline data
python train_model.py --input output/merged.jsonl --output output/model/
```

## Environment Variables

Copy `.env.example` to `.env` and configure:
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` - GitHub OAuth app credentials
- `SESSION_SECRET` - Random string for session encryption
- `ADMIN_USERS` - Comma-separated GitHub usernames with admin access
- `PRIVATE_BASELINE_PATH` - Path to private baseline training data (local only)
- `BOUNCE_CLASSIFIER_MODEL_PATH` - Path to bounce-classifier model dir (auto-copy after retrain)
