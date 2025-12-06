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
    Generate exactly {num} examples of engagement bait vs genuine content in JSON array format. Do not include any markdown formatting or code block markers.

    Format should follow this structure:
    {{
        "engagement_bait": "text",
        "genuine_content": "text",
        "topic": "category"
    }}

    Engagement bait should employ these psychological tactics:
    1. Challenge deeply-held beliefs or identity ("Everything you learned about sleep is wrong")
    2. Create information gaps ("The morning habit successful people never talk about")
    3. Invoke social proof anxiety ("Why your neighbors stopped doing this common practice")
    4. Use false urgency ("This everyday habit is quietly damaging your brain")
    5. Leverage negativity bias ("The dark truth about your favorite productivity hack")
    6. Employ authority undermining ("Experts kept this wellness secret hidden for decades")
    7. Create FOMO ("The investment strategy millennials are abandoning")
    8. Use contrarian positioning ("Why being messy makes you smarter")
    9. Trigger comparative anxiety ("The simple trick that made me earn twice as much")
    10. Appeal to insider knowledge ("What silicon valley executives actually do before meetings")

    Genuine content should:
    - Express personal experience rather than universal claims
    - Avoid sensationalism or extreme positions
    - Include nuance and specific context
    - Focus on sharing information rather than provoking reactions

    Topics should include:
    - Personal finance
    - Career development
    - Relationships
    - Health & wellness
    - Technology trends
    - Education
    - Environmental issues
    - Politics
    - Local community
    - Mental health
    - Parenting
    - Consumer technology

    IMPORTANT: 
    - Each engagement bait example should use a different psychological tactic
    - Make the engagement bait subtle and sophisticated rather than obvious
    - Ensure the genuine content version conveys similar information but without manipulation
    - Response must be valid JSON array format only, no additional text or markdown formatting
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