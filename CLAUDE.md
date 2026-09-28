# CLAUDE.md

## Rules

- Never use emojis in code, comments, or documentation.
- Do not include Claude as a co-contributor in commit messages.
- Use Conventional Commit format for all commit messages.

## Project Overview

Web interface and training pipeline for the [@postalsys/bounce-classifier](https://github.com/postalsys/bounce-classifier) npm package. Allows the community to submit labeled SMTP bounce messages to improve the classifier.

## Architecture

- `web/` - Node.js + Express web app with GitHub OAuth, SQLite storage
- `pipeline/` - Python training pipeline (TensorFlow/Keras): merge data, train, export
- `data/` - Community-submitted labeled training data and `label-definitions-v1.json` (committed to git)

The data-stage scripts (normalize, dedupe, regex labeling) live only in the private bounce-data repo. `data/label-definitions-v1.json` describes the 16 labels for TypeSafe; the web pre-screen and bounce-data's labeling tools both read it, so version it (`labels-v2`) instead of editing meanings in place.

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
venv/bin/python -m unittest discover -s tests -t tests
```

TensorFlow needs Python 3.10 to 3.13; `setup-venv.sh` falls back to a uv-managed interpreter when the system Python is newer. The export writes the weight shard and `model.json` directly (no tensorflowjs converter) and verifies them against Keras before finishing.

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
- `GOLD_SET_PATH` - Human-verified evaluation rows that `merge_data.py` removes from training (local only)
- `TYPESAFE_API_KEY` / `TYPESAFE_MODEL` - Optional; pre-screen proposals so the admin queue can sort by disagreement
- `BOUNCE_CLASSIFIER_MODEL_PATH` - Path to bounce-classifier model dir (auto-copy after retrain)
