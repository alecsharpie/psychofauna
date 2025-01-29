
from datasets import Dataset
from transformers import (
    DistilBertTokenizer,
    DistilBertForSequenceClassification,
    Trainer,
    TrainingArguments
)
import pandas as pd
import numpy as np
from sklearn.metrics import accuracy_score, precision_recall_fscore_support
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def compute_metrics(pred):
    labels = pred.label_ids
    preds = pred.predictions.argmax(-1)
    precision, recall, f1, _ = precision_recall_fscore_support(labels, preds, average='binary')
    acc = accuracy_score(labels, preds)
    return {
        'accuracy': acc,
        'f1': f1,
        'precision': precision,
        'recall': recall
    }

def train():
    # Load the generated dataset
    df = pd.read_csv("outrage_training_data.csv")
    
    # Convert to HuggingFace Dataset
    dataset = Dataset.from_pandas(df)
    
    # Split dataset
    dataset = dataset.train_test_split(test_size=0.2)
    
    # Load tokenizer and model
    tokenizer = DistilBertTokenizer.from_pretrained('distilbert-base-uncased')
    model = DistilBertForSequenceClassification.from_pretrained(
        'distilbert-base-uncased',
        num_labels=2
    )
    
    def tokenize_function(examples):
        return tokenizer(examples["text"], padding="max_length", truncation=True)
    
    # Apply tokenization
    tokenized_datasets = dataset.map(tokenize_function, batched=True)
    
    # Training arguments
    training_args = TrainingArguments(
        output_dir="./results",
        learning_rate=2e-5,
        per_device_train_batch_size=16,
        per_device_eval_batch_size=16,
        num_train_epochs=3,
        weight_decay=0.01,
        evaluation_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        logging_dir='./logs',
        logging_steps=10
    )
    
    # Initialize trainer
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized_datasets["train"],
        eval_dataset=tokenized_datasets["test"],
        compute_metrics=compute_metrics,
    )
    
    # Train and evaluate
    trainer.train()
    
    # Final evaluation
    final_metrics = trainer.evaluate()
    logger.info(f"Final evaluation metrics: {final_metrics}")
    
    # Save model
    model_save_path = "./engagement_classifier"
    trainer.save_model(model_save_path)
    logger.info(f"Model saved to {model_save_path}")
    
    # Test some examples
    test_texts = [
        "Why everything you know about productivity is WRONG",
        "I found these productivity techniques helpful for my workflow",
    ]
    
    inputs = tokenizer(test_texts, padding=True, truncation=True, return_tensors="pt")
    outputs = model(**inputs)
    predictions = outputs.logits.argmax(dim=-1)
    
    logger.info("\nTest predictions:")
    for text, pred in zip(test_texts, predictions):
        logger.info(f"Text: {text}")
        logger.info(f"Prediction: {'Engagement Bait' if pred == 1 else 'Genuine Content'}\n")

if __name__ == "__main__":
    train()