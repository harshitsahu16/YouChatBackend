const express = require('express');
const bcryptjs = require('bcryptjs');
const jwt = require('jsonwebtoken');
const PORT = process.env.PORT || 8000;

const cors = require('cors');
const app = express();
const server = require('http').createServer(app);

const io = require('socket.io')(server, {
    cors: {
        origin: ['https://radiant-swan-184144.netlify.app' , 'http://localhost:3000'],
        methods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    }
});
//connnect db
require('./db/connection');

//import files
const Users = require('./models/Users');
const Conversation = require('./models/Conversation');
const Messages = require('./models/Messages')


//app use
app.use(express.json());
app.use(express.urlencoded({extended:false}));
app.use(cors());


//socket.io
let users = [];
io.on('connection', socket => {
    console.log('User Connected', socket.id);
    socket.on('addUser', userId => {
        const isUserExist = users.find(user => user.userId === userId);
        if(!isUserExist){
            const user = {userId , socketId: socket.id};
            users.push(user);
            io.emit('getUsers' , users);
        }
    });

    socket.on('sendMessage' , async ({senderId,receiverId,conversationId,message}) => {
        const receiver = users.find(user => user.userId === receiverId);
        const sender = users.find(user => user.userId === senderId);
        const user = await Users.findById(senderId);
        if (receiver) {
            io.to(receiver.socketId).to(sender.socketId).emit('getMessage', {senderId,conversationId,message,receiverId, user: { id: user._id , fullName: user.fullName , email: user.email} });
        } else {
            io.to(sender.socketId).emit('getMessage', {senderId,conversationId,message,receiverId, user: { id: user._id , fullName: user.fullName , email: user.email} }); 
        }
    });

    socket.on('disconnect' , () => {
        users = users.filter(user => user.socketId !== socket.id);
        io.emit('getUsers' , users);
    })
    
});

//routes
app.get('/' , (req,res) => {
    res.send('Welcome to my server');
});

app.post('/api/register', async (req, res) => {
    try {
        const { fullName, email, password } = req.body;

        console.log('Request Body:', req.body);

        if (!fullName || !email || !password) {
            console.log('Missing required fields');
            return res.status(400).send('Please fill all required fields');
        }

        const isAlreadyExist = await Users.findOne({ email });
        if (isAlreadyExist) {
            console.log('User already exists');
            return res.status(400).send('User already exists');
        }

        const newUser = new Users({ fullName, email });
        bcryptjs.hash(password, 10, async (err, hashedPassword) => {
            if (err) {
                console.error('Error hashing password:', err);
                return res.status(500).send('Error hashing password');
            }

            newUser.set('password', hashedPassword);
            try {
                await newUser.save();
                console.log('User registered successfully');
                return res.status(200).send('User registered successfully');
            } catch (saveErr) {
                console.error('Error saving user:', saveErr);
                return res.status(500).send('Error saving user');
            }
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('Internal server error');
    }
});

app.post('/api/login' , async (req,res,next) => {
    try{
        const{email,password} = req.body;

        if(!email || !password){
            res.status(400).send('Please fill all required fields');
        } else {
            const user = await Users.findOne({email});
            if(!user){
                res.status(400).send('user email or password is invalid');
            } else {
                const validateUser = await bcryptjs.compare(password , user.password);
                if(!validateUser){
                    res.status(400).send('user email or password is invalid');
                } else {
                    const payload = {
                        userId: user._id,
                        email: user.email
                    }
                    const JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'THIS_IS_A_JWT_SECRET_KEY';

                    jwt.sign(payload, JWT_SECRET_KEY, { expiresIn: 84600}, async (err, token) => {
                        await Users.updateOne({ _id:user.id } , {
                            $set: {token}
                        })
                        user.save();
                        return res.status(200).json({ user: {id:user._id,email: user.email, fullName: user.fullName }, token: token })
                    })
                    
                }
            }

        }

    } catch(error){
        console.log(error , "Error");
    }
})

app.post('/api/conversation', async (req,res) => {
    try{
        const { senderId , receiverId} = req.body;
        const newConversation = new Conversation({members: [senderId,receiverId]});
        await newConversation.save();
        res.status(200).send('Conversation created succcessfully');
    } catch(error){
        console.log(error, 'Error');
    }
});

app.get('/api/conversations/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const conversations = await Conversation.find({ members: { $in: [userId] } });
        
        const conversationOtherUserData = await Promise.all(conversations.map(async (conversation) => {
            const receiverId = conversation.members.find((member) => member !== userId);
            const user = await Users.findById(receiverId);

            if (user) {
                return {
                    user: {
                        receiverId: user._id,
                        email: user.email,
                        fullName: user.fullName
                    },
                    conversationId: conversation._id
                };
            } else {
                console.error(`User not found for receiverId: ${receiverId}`);
                return {
                    user: null,
                    conversationId: conversation._id
                };
            }
        }));

        res.status(200).json(conversationOtherUserData);
    } catch (error) {
        console.log(error, 'Error');
        res.status(500).json({ message: 'Internal Server Error' });
    }
});


app.post('/api/message', async(req,res) => {
    try {
       const {conversationId , senderId , message, receiverId = ''} = req.body;
       if(!senderId || !message) return res.status(400).send('Please fill all fields');
       if(conversationId === 'new' && receiverId){
        const newConversation = new Conversation({members:[senderId,receiverId]});
        await newConversation.save();
        const newMessage = new Messages({conversationId:newConversation._id , senderId , message});
        await newMessage.save();
        return res.status(200).send('New Message Sent successfully');
       } else if(!conversationId && !receiverId) {
        return res.status(400).send('Please fill all required fields')
       }
       const newMessage = new Messages({conversationId,senderId, message}) ;
       await newMessage.save();
       res.status(200).send('Messages sent successfully');
    } catch (error) {
        console.log(error,'Error');
    }
})

app.get('/api/message/:conversationId' , async(req,res) => {
    try {
        const checkMessages = async (conversationId) => {
            const messages = await Messages.find({conversationId});
            const messageUserData = Promise.all(messages.map(async(message) => {
            const user = await Users.findById(message.senderId);
            return {user:{id:user._id , email:user.email , fullName:user.fullName}, message:message.message}
        }));
        res.status(200).json(await messageUserData);
        }
        const conversationId = req.params.conversationId;
        if(conversationId === 'new') {
            const checkConversation = await Conversation.find({ members: { $all: [req.query.senderId, req.query.receiverId] } });
            if(checkConversation.length > 0 ) {
                checkMessages(checkConversation[0]._id);
            } else {
                return res.status(200).json([]);
            }
        } else {
            checkMessages(conversationId);
        }
    } catch (error) {
        console.log('Error', error);
    }
})

app.get('/api/users/:userId' , async(req,res) => {
    try{
        const userId = req.params.userId;
        const users = await Users.find({ _id: { $ne: userId } });
        const usersData = Promise.all(users.map(async (user) => {
            return {user: {email:user.email , fullName:user.fullName, receiverId:user._id}}
        }))
        res.status(200).json(await usersData);
    } catch(error){
        console.log('Error',error);
    }
})

server.listen(PORT , () => {
    console.log('Server is listening on port' + PORT);
});