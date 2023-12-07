const AWS = require('aws-sdk');
const ddb = new AWS.DynamoDB.DocumentClient();
const redis = require("redis");

exports.handler = async function (event, context) {
    let connectionInfo;
    let connectionId = event.requestContext.connectionId;

    const callbackAPI = new AWS.ApiGatewayManagementApi({
        apiVersion: '2018-11-29',
        endpoint:
            event.requestContext.domainName + '/' + event.requestContext.stage,
    });

    try {
        connectionInfo = await callbackAPI
            .getConnection({ ConnectionId: event.requestContext.connectionId })
            .promise();
    } catch (e) {
        console.log(e);
    }

    connectionInfo.connectionID = connectionId;

    const redisClient = redis.createClient({url:"redis://rplace.wqvx0c.ng.0001.use2.cache.amazonaws.com:6379"});

    let board;
    try {
        await redisClient.connect();

        // Check if the board exists
        board = await redisClient.exists('board');

        // If the board doesn't exist, create a white board
        if (!board) {
            const whitePixel = "FFFFFF";
            const totalPixels = 1000 * 1000;
            board = whitePixel.repeat(totalPixels);
            await redisClient.set('board', board);
        }
        else {
            board = await redisClient.get('board');
        }
    } catch (err) {
        try {
            board = await ddb.scan({ TableName: process.env.boardTable }).promise();
        } catch (err) {
            return {
                statusCode: 500,
                message: `fail to connect to both Redis and DB with error: ${err}`
            };
        }
    }

    await callbackAPI
        .postToConnection({
            ConnectionId: event.requestContext.connectionId,
            Data: JSON.stringify(board),
        })
        .promise();

    return {
        statusCode: 200,
    };
};