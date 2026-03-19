-- Add embedding columns as float arrays (384 dimensions for all-MiniLM-L6-v2)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS embedding DOUBLE PRECISION[];
ALTER TABLE users ADD COLUMN IF NOT EXISTS interest_embedding DOUBLE PRECISION[];

-- Create a SQL function for cosine similarity between two float arrays
CREATE OR REPLACE FUNCTION cosine_similarity(a DOUBLE PRECISION[], b DOUBLE PRECISION[])
RETURNS DOUBLE PRECISION AS $$
DECLARE
    dot_product DOUBLE PRECISION := 0;
    norm_a DOUBLE PRECISION := 0;
    norm_b DOUBLE PRECISION := 0;
    i INTEGER;
BEGIN
    IF a IS NULL OR b IS NULL OR array_length(a, 1) IS NULL OR array_length(b, 1) IS NULL OR array_length(a, 1) != array_length(b, 1) THEN
        RETURN 0;
    END IF;
    FOR i IN 1..array_length(a, 1) LOOP
        dot_product := dot_product + (a[i] * b[i]);
        norm_a := norm_a + (a[i] * a[i]);
        norm_b := norm_b + (b[i] * b[i]);
    END LOOP;
    IF norm_a = 0 OR norm_b = 0 THEN RETURN 0; END IF;
    RETURN dot_product / (sqrt(norm_a) * sqrt(norm_b));
END;
$$ LANGUAGE plpgsql IMMUTABLE;
