const AWS = require('aws-sdk');
const ddb = new AWS.DynamoDB.DocumentClient();
const redis = require("redis");

exports.handler = async function (event, context) {
    const message = JSON.parse(event.body).message;

    // Check if the user has drawn in the last 5 minutes
    // try {
    //     const userTime = await ddb.query({
    //         TableName: process.env.userTable,
    //         KeyConditionExpression: 'userId = :userId',
    //         ExpressionAttributeValues: {
    //             ':userId': message.user,
    //         },
    //     }).promise();
    //     if (!(userTime.Items.length === 0 || Date.now() - userTime.Items[0].time > 300000)) {
    //         return {
    //             statusCode: 403,
    //             message: "You can only draw once every 5 minutes"
    //         };
    //     }
    // } catch (err) {
    //     return {
    //         statusCode: 500,
    //         message: `fail to connect user db with error: ${err}`
    //     };
    // }

    try {
        await ddb
            .put({
                TableName: process.env.boardTable,
                Item: {
                    coordinate: `${message.x},${message.y}`,
                    color: message.color,
                    user: message.user,
                    time: Date.now(),
                },
            })
            .promise();
    } catch (err) {
        console.log('err: ', err)
        return {
            statusCode: 500,
            message: `fail to connect board db with error: ${err}`
        };
    }

    const redisClient = redis.createClient({url:"redis://rplace.wqvx0c.ng.0001.use2.cache.amazonaws.com:6379"});

    await redisClient.connect();

    try {
        // Check if the board exists
        const boardExists = await redisClient.exists('board');

        // If the board doesn't exist, create a white board
        if (!boardExists) {

            const whitePixel = "FFFFFF";
            const totalPixels = 1000 * 1000;
            const whiteBoard = whitePixel.repeat(totalPixels);

            await redisClient.SET('board', whiteBoard);
        }
        // Get rid of the # in the color
        let color = message.color.slice(1);
        const offset = (message.x + message.y * 1000) * 6;

        // Set the color at the offset
        await redisClient.SETRANGE("board", offset, color);
        console.log('offset: ', offset)

    } catch (err) {
        return {
            statusCode: 500,
            message: `fail to connect redis cache with error: ${err}`
        };
    }

    let connections;
    try {
        connections = await ddb.scan({ TableName: process.env.table }).promise();
    } catch (err) {
        return {
            statusCode: 500,
            message: `fail to connect connection db with error: ${err}`
        };
    }
    const callbackAPI = new AWS.ApiGatewayManagementApi({
        apiVersion: '2018-11-29',
        endpoint:
            event.requestContext.domainName + '/' + event.requestContext.stage,
    });

    const sendMessages = connections.Items.map(async ({ connectionId }) => {
        try {
            await callbackAPI
                .postToConnection({ ConnectionId: connectionId, Data: JSON.stringify(message) })
                .promise();
        } catch (e) {
            console.log(e);
        }
    });

    try {
        await Promise.all(sendMessages);
    } catch (e) {
        console.log(e);
        return {
            statusCode: 500,
            message: `cant send message with error: ${e}`
        };
    }

    // Update the user's last draw time
    try {
        await ddb
            .put({
                TableName: process.env.userTable,
                Item: {
                    userId: message.user,
                    time: Date.now(),
                },
            })
            .promise();
    } catch (err) {
        console.log('err: ', err)
        return {
            statusCode: 500,
            message: `fail to connect user db with error: ${err}`
        };
    }

    return { statusCode: 200 };
};