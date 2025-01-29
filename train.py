from datasets import Dataset
from transformers import (
    DistilBertTokenizer,
    DistilBertForSequenceClassification,
    DistilBertConfig,
    Trainer,
    TrainingArguments,
    EarlyStoppingCallback
)
import pandas as pd
import numpy as np
import torch
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, precision_recall_fscore_support, classification_report
import logging
from typing import Dict, Any

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('training.log')
    ]
)
logger = logging.getLogger(__name__)

def set_device() -> torch.device:
    """Set up the appropriate device for training."""
    # Force CPU usage regardless of available hardware
    device = torch.device("cpu")
    logger.info("Using CPU")
    return device

def compute_metrics(pred) -> Dict[str, float]:
    """
    Compute evaluation metrics for the model.
    """
    labels = pred.label_ids
    preds = pred.predictions.argmax(-1)
    
    # Calculate metrics
    precision, recall, f1, _ = precision_recall_fscore_support(
        labels, 
        preds, 
        average='binary',
        zero_division=0
    )
    acc = accuracy_score(labels, preds)
    
    # Get detailed classification report
    report = classification_report(labels, preds)
    logger.info(f"\nClassification Report:\n{report}")
    
    return {
        'accuracy': acc,
        'f1': f1,
        'precision': precision,
        'recall': recall
    }

def prepare_dataset(file_path: str):
    """
    Load and prepare the dataset with stratified split.
    """
    try:
        df = pd.read_csv(file_path)
        logger.info(f"Loaded dataset with {len(df)} examples")
        
        # Check class balance
        class_dist = df['label'].value_counts(normalize=True)
        logger.info(f"Class distribution:\n{class_dist}")
        
        # Perform stratified split using sklearn
        train_df, test_df = train_test_split(
            df,
            test_size=0.2,
            stratify=df['label'],
            random_state=42
        )
        
        # Ensure 'text' and 'label' columns exist
        required_columns = ['text', 'label']
        if not all(col in df.columns for col in required_columns):
            raise ValueError(f"Dataset must contain columns: {required_columns}")
        
        # Convert to HuggingFace Datasets
        train_dataset = Dataset.from_pandas(train_df.reset_index(drop=True))
        test_dataset = Dataset.from_pandas(test_df.reset_index(drop=True))
        
        return {
            "train": train_dataset,
            "test": test_dataset
        }
    except Exception as e:
        logger.error(f"Error loading dataset: {e}")
        raise

def train():
    # Set device
    device = set_device()
    
    try:
        # Load and prepare dataset
        dataset_dict = prepare_dataset("outrage_training_data.csv")
        
        # Load tokenizer
        tokenizer = DistilBertTokenizer.from_pretrained('distilbert-base-uncased')
        
        # Load config and update dropout settings
        config = DistilBertConfig.from_pretrained(
            'distilbert-base-uncased',
            num_labels=2,
            dropout=0.2
        )
        
        model = DistilBertForSequenceClassification.from_pretrained(
            'distilbert-base-uncased',
            config=config
        ).to(device)
        
        def tokenize_function(examples):
            """Tokenize while keeping the labels"""
            tokenized = tokenizer(
                examples["text"],
                padding="max_length",
                truncation=True,
                max_length=128
            )
            # Make sure to return the labels along with the tokenized inputs
            tokenized["labels"] = examples["label"]
            return tokenized
        
        # Apply tokenization
        tokenized_datasets = {
            split: dataset.map(
                tokenize_function,
                batched=True,
                remove_columns=dataset.column_names
            )
            for split, dataset in dataset_dict.items()
        }
        
        # Training arguments
        training_args = TrainingArguments(
            output_dir="./results",
            learning_rate=2e-5,
            per_device_train_batch_size=16,
            per_device_eval_batch_size=16,
            num_train_epochs=10,
            weight_decay=0.01,
            evaluation_strategy="steps",
            eval_steps=50,
            save_strategy="steps",
            save_steps=50,
            load_best_model_at_end=True,
            metric_for_best_model="f1",
            logging_dir='./logs',
            logging_steps=10,
            warmup_steps=500,
            fp16=False,
            gradient_accumulation_steps=2,
            report_to="none",
            use_cpu=True,  # Force CPU usage
            use_mps_device=False  # Explicitly disable MPS
        )
        
        # Initialize trainer with early stopping
        trainer = Trainer(
            model=model,
            args=training_args,
            train_dataset=tokenized_datasets["train"],
            eval_dataset=tokenized_datasets["test"],
            compute_metrics=compute_metrics,
            callbacks=[EarlyStoppingCallback(early_stopping_patience=3)]
        )
        
        # Train and evaluate
        trainer.train()
        
        # Final evaluation
        final_metrics = trainer.evaluate()
        logger.info(f"Final evaluation metrics: {final_metrics}")
        
        # Save model
        model_save_path = "./engagement_classifier"
        trainer.save_model(model_save_path)
        tokenizer.save_pretrained(model_save_path)
        logger.info(f"Model and tokenizer saved to {model_save_path}")
        
        # Test examples
        test_texts = [
            "Why everything you know about productivity is WRONG",
            "I found these productivity techniques helpful for my workflow",
            "The shocking truth about morning routines",
            "Here's how I improved my morning routine over time",
        ]
        
        # Perform inference
        with torch.no_grad():
            inputs = tokenizer(test_texts, padding=True, truncation=True, return_tensors="pt")
            inputs = {k: v.to(device) for k, v in inputs.items()}
            outputs = model(**inputs)
            predictions = outputs.logits.argmax(dim=-1)
        
        logger.info("\nTest predictions:")
        for text, pred in zip(test_texts, predictions):
            logger.info(f"Text: {text}")
            logger.info(f"Prediction: {'Engagement Bait' if pred == 1 else 'Genuine Content'}\n")
            
    except Exception as e:
        logger.error(f"Training failed with error: {e}")
        raise

if __name__ == "__main__":
    train()