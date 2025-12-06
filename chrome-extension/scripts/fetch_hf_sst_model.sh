#!/usr/bin/env sh
# Fetch the Xenova sentiment SST-2 model artifacts into chrome-extension/models/sst2
# Requires a Hugging Face token in $HUGGING_FACE_HUB_TOKEN (read-only is fine).

set -euf

if [ -z "${HUGGING_FACE_HUB_TOKEN:-}" ]; then
  echo "Error: Please export HUGGING_FACE_HUB_TOKEN before running this script." >&2
  echo "You can create a read-only token at https://huggingface.co/settings/tokens" >&2
  exit 1
fi

# Resolve curl binary
CURL_BIN="${CURL_BIN:-$(command -v curl || true)}"
if [ -z "${CURL_BIN}" ]; then
  echo "Error: curl not found. Install curl and re-run." >&2
  exit 1
fi

# Resolve repo root (works in bash/zsh/posix sh)
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
MODEL_DIR="${ROOT_DIR}/models/sst2"
BASE_URL="https://huggingface.co/Xenova/distilbert-base-uncased-finetuned-sst-2-english/resolve/main"

mkdir -p "${MODEL_DIR}/onnx"

download() {
  path="$1"
  dest="${MODEL_DIR}/${path}"
  url="${BASE_URL}/${path}"
  echo "Downloading ${path}..."
  "${CURL_BIN}" -sSfL -H "Authorization: Bearer ${HUGGING_FACE_HUB_TOKEN}" "${url}" -o "${dest}"
}

download "config.json"
download "tokenizer.json"
download "tokenizer_config.json"
download "special_tokens_map.json"
download "vocab.txt"

# Quantized ONNX weights (smaller/faster). If you prefer the full fp32 model,
# also grab onnx/model.onnx similarly.
download "onnx/model_quantized.onnx"

echo "Done. Files saved under ${MODEL_DIR}"

