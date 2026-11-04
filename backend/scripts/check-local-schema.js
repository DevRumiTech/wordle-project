const { mysql, localOptions, inspectSchema } = require('./local-database');
async function main() {
    const connection = await mysql.createConnection(localOptions());
    try {
        const columns = await inspectSchema(connection);
        console.log('174 PASS: local MySQL connection and required authentication columns');
        console.log(JSON.stringify(columns, null, 2));
    } finally { await connection.end(); }
}
main().catch(() => {
    console.error('174 FAIL: local schema check failed; no schema changes were attempted');
    process.exitCode = 1;
});
