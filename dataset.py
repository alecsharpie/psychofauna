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
    
    
    # TODO get examples for each topic you want to avoid from a file?
    prompt_template = """
    Generate exactly {num} examples of engagement bait vs genuine content.
    Return them in a JSON array format. Do not include any markdown formatting or code block markers.
    Format:
    [
        {{
            "engagement_bait": "Working from home is overrated",
            "genuine_content": "I enjoy going to the office more than working from home",
            "topic": "life"
        }},
        {{
            "engagement_bait": "Why your favorite self-care routine might be making you more anxious",
            "genuine_content": "I find my self-care routine helps me relax and unwind",
            "topic": "health"
        }},
        {{
            "engagement_bait": "Being disorganized made me more successful",
            "genuine_content": "I find that being organized helps me be more productive",
            "topic": "productivity"
        }},
        {{
            "engagement_bait": "The hidden environmental cost of minimalism",
            "genuine_content": "I think minimalism is a great way to reduce waste",
            "topic": "environment"
        }}
    ]
    
    Engagement bait works because it is designed to:
    Challenge assumptions people hold about themselves
    Create cognitive dissonance that makes people want resolution
    Tap into common insecurities or aspirations
    Feel personally relevant
    Promise insider knowledge or counterintuitive wisdom
    
    Topics should include: local news, politics, education, environment, technology, health, consumer issues, life
    
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
            print(examples)
            logger.info(f"Successfully parsed {len(examples)} examples")
        except json.JSONDecodeError as e:
            logger.error(f"JSON parsing failed. Error: {str(e)}")
            logger.error(f"Attempted to parse text: {cleaned_text}")
            raise
        
        dataset = []
        for ex in examples:
            print(ex)
            dataset.extend([
                {"text": ex["engagement_bait"], "label": 1},
                {"text": ex["genuine_content"], "label": 0}
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