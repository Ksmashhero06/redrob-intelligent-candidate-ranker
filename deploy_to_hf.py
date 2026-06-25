#!/usr/bin/env python3
"""Upload hf_space/ files to HuggingFace Space using the cached token."""
import sys
from pathlib import Path

try:
    from huggingface_hub import HfApi, login
    from huggingface_hub.utils import HfHubHTTPError
except ImportError:
    print("pip install huggingface_hub")
    sys.exit(1)

# Try to use cached token from huggingface-cli login
# If that fails, prompt for token
import argparse
parser = argparse.ArgumentParser()
parser.add_argument("--token", default=None, help="HuggingFace write token (optional if already logged in)")
args = parser.parse_args()

# Try to detect repo — browser created it under 'ksmashhero' (without '06')
# We'll try both and use whichever exists
CANDIDATE_IDS = ["ksmashhero", "Ksmashhero06"]
SPACE_NAME = "redrob-candidate-ranker"
SPACE_DIR = Path(__file__).parent / "hf_space"

FILES = [
    ("app.py",                 "app.py"),
    ("rank.py",                "rank.py"),
    ("requirements.txt",       "requirements.txt"),
    ("README.md",              "README.md"),
    ("sample_candidates.json", "sample_candidates.json"),
]

api = HfApi(token=args.token)

# Detect which username the Space was created under
repo_id = None
for uid in CANDIDATE_IDS:
    try:
        api.repo_info(repo_id=f"{uid}/{SPACE_NAME}", repo_type="space")
        repo_id = f"{uid}/{SPACE_NAME}"
        print(f"Found Space: {repo_id}")
        break
    except Exception:
        pass

if not repo_id:
    # Create it fresh under the first available username
    # Just try both
    for uid in CANDIDATE_IDS:
        try:
            api.create_repo(
                repo_id=f"{uid}/{SPACE_NAME}",
                repo_type="space",
                space_sdk="streamlit",
                private=False,
                exist_ok=True,
            )
            repo_id = f"{uid}/{SPACE_NAME}"
            print(f"Created Space: {repo_id}")
            break
        except Exception as e:
            print(f"Could not create under {uid}: {e}")

if not repo_id:
    print("ERROR: Could not find or create Space. Please run: huggingface-cli login")
    sys.exit(1)

print(f"Uploading files to: {repo_id}")
for local_name, remote_name in FILES:
    local_path = SPACE_DIR / local_name
    if not local_path.exists():
        print(f"  SKIP (not found): {local_path}")
        continue
    print(f"  {local_name} ...", end=" ", flush=True)
    api.upload_file(
        path_or_fileobj=str(local_path),
        path_in_repo=remote_name,
        repo_id=repo_id,
        repo_type="space",
    )
    print("OK")

url = f"https://huggingface.co/spaces/{repo_id}"
print(f"\nDone! Space URL: {url}")
print(f"\nUpdate submission_metadata.yaml line 33:")
print(f'  sandbox_link: "{url}"')
