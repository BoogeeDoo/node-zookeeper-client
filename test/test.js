var zookeeper = require('../index.js');

var client = zookeeper.createClient(
    process.argv[2] || 'localhost:2181',
    {
        timeout : 30000,
        spinDelay : 1000
    }
);


client.on('state', function (state) {
    console.log('New state: ' + state);
});

client.on('error', function (error) {
    console.log('Got error: ' + error);
});


client.connect();