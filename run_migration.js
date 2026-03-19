require('dotenv').config();
const pool = require('./db');

async function run() {
    try {
        await pool.query(`
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
        `);
        console.log('SUCCESS: cosine_similarity function created');

        // Verify
        const res = await pool.query("SELECT cosine_similarity(ARRAY[1.0,0.0,0.0], ARRAY[1.0,0.0,0.0]) as sim");
        console.log('Test cosine_similarity([1,0,0], [1,0,0]) =', res.rows[0].sim);

        const res2 = await pool.query("SELECT cosine_similarity(ARRAY[1.0,0.0,0.0], ARRAY[0.0,1.0,0.0]) as sim");
        console.log('Test cosine_similarity([1,0,0], [0,1,0]) =', res2.rows[0].sim);

    } catch (err) {
        console.error('ERROR:', err.message);
    } finally {
        await pool.end();
    }
}
run();
