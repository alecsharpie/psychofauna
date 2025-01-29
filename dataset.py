import google.generativeai as genai
import pandas as pd
import json
import os
import logging
import re

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
model = genai.GenerativeModel("gemini-1.5-flash")

def generate_outrage_examples(num_examples=100):
    prompt_template = """
    Generate exactly {num} examples of manufactured outrage vs neutral content. 
    Return them in a JSON array format. Do not include any markdown formatting or code block markers.
    Format:
    [
        {{
            "outrage_version": "SHOCKING: Local School Serves Regular Milk Instead of Organic - Parents OUTRAGED!",
            "neutral_version": "School cafeteria continues standard milk service, some parents express preference for organic options",
            "topic": "education"
        }},
        // more examples...
    ]
    
    Common patterns in manufactured outrage:
    - Excessive capitalization
    - Emotional manipulation
    - Catastrophizing
    - Us vs. them framing
    - Slippery slope arguments
    - Conspiracy undertones
    
    Topics should include: local news, politics, education, environment, technology, health, consumer issues
    
    IMPORTANT: Response must be valid JSON array format only, no additional text or markdown.
    """
    
    try:
        logger.info(f"Generating {num_examples} examples...")
        response = model.generate_content(
            prompt_template.format(num=min(10, num_examples)),
            generation_config=genai.GenerationConfig(
                max_output_tokens=1000,
                temperature=0.7,
            )
        )
        
        logger.info("Raw response received from model")
        logger.debug(f"Raw response text: {response.text}")
        
        # Clean up the response text to ensure valid JSON
        cleaned_text = response.text.strip()
        # Remove markdown code block if present
        cleaned_text = re.sub(r'^```json\n|\n```$', '', cleaned_text)
        # Remove any remaining markdown markers
        cleaned_text = re.sub(r'^```|\n```$', '', cleaned_text)
        cleaned_text = cleaned_text.strip()
        
        logger.info("Attempting to parse JSON response")
        try:
            examples = json.loads(cleaned_text)
            logger.info(f"Successfully parsed {len(examples)} examples")
        except json.JSONDecodeError as e:
            logger.error(f"JSON parsing failed. Error: {str(e)}")
            logger.error(f"Attempted to parse text: {cleaned_text}")
            raise
        
        dataset = []
        for ex in examples:
            dataset.extend([
                {"text": ex["outrage_version"], "label": 1},
                {"text": ex["neutral_version"], "label": 0}
            ])
        
        logger.info(f"Created dataset with {len(dataset)} entries")
        return pd.DataFrame(dataset)
        
    except Exception as e:
        logger.error(f"Error in generate_outrage_examples: {str(e)}")
        raise

if __name__ == "__main__":
    try:
        logger.info("Starting data generation...")
        df = generate_outrage_examples(10)
        
        # Print first few examples
        logger.info("\nFirst few examples generated:")
        print(df.head())
        
        # Save to CSV
        output_file = "outrage_training_data.csv"
        df.to_csv(output_file, index=False)
        logger.info(f"Data saved to {output_file}")
        
    except Exception as e:
        logger.error(f"Main execution failed: {str(e)}")