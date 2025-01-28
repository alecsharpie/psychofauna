# Example conversion using Hugging Face transformers
from transformers import DistilBertForSequenceClassification
import torch.onnx

model = DistilBertForSequenceClassification.from_pretrained("distilbert-base-uncased")
dummy_input = torch.zeros(1, 128, dtype=torch.long)  # Batch size 1, 128 tokens
torch.onnx.export(model, dummy_input, "distilbert.onnx")

from onnxruntime.quantization import quantize_dynamic
quantize_dynamic("distilbert.onnx", "quantized-distilbert.onnx")
