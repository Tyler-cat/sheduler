# AI Service

This FastAPI microservice covers Stage 4 of the implementation plan by exposing the timetable parsing workflow backed by a configurable LLM provider router.

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
```

## Running

```bash
uvicorn app.main:app --reload
```

## Tests

```bash
pytest
```
