const express=require('express');
var app=express();
const mongoose=require('mongoose');
const mongo=require('mongodb');
const bodyParser=require('body-parser');
const cors=require('cors');
const lodash=require('lodash');
const fs=require('fs');
// const { EnglishStemmer } = require('snowball-stemmers');
const Snowball= require('snowball-stemmers');
const e = require('express');

const PORT=3000;
const connectioString='mongodb+srv://abouelhadidola:8aWAvyLwc824XSm8@searchengine.uwkyb5b.mongodb.net/?retryWrites=true&w=majority';

app.use(bodyParser.json());
app.use(cors());

//Connect to the database
const client=new mongo.MongoClient(connectioString,{useNewUrlParser:true,useUnifiedTopology:true});
const connectToDatabase=async()=>{
    try{
        await client.connect();
        console.log('Connected to the database successfully');
    }
    catch(error){
        console.log('Error in connecting to the database');
    }
};

connectToDatabase();
//Access the database
const database=client.db("SearchEngine");
//Start the server
const server=app.listen(PORT,()=>console.log(`Server is running on port ${PORT}`));
server.on('error', () => {
    console.log('Server error', error);
});


// Routes

//test route
app.get('/test',async (req,res)=>{
    const name=req.query.name;
    return res.status(200).json({message: `Hello ${name}`});
}
);

// store the previous queries by the user: in the database 
//Collection called suggestions
// with every new query, search the database for the previous queries and return the suggestions
// the frontend will send the request with every new character added to the query
// the backend will search the database for the previous queries that start with the new query

app.get('/suggestion',async (req,res)=>{
    //get the query from the request
    const query=req.query.query;
    //search the database for the previous queries that start with the new query
    //search in the collection called Suggestions
    //return an array of strings as a response
    //finding only the first 8 results as a maximum limit
    const foundQueries=await database.collection("Suggestions").find({query:{$regex:`^${query}`}}).limit(8).toArray();
    // console.log(foundQueries);
    const response=[];
    foundQueries.forEach(object => {
        response.push(object.query);
    });
    //return the response
    try{
        return res.status(200).json(response);
    }
    catch(error){
        console.log('Error in returning the response');
    }

});




//note that you have to store the query 
app.get('/search',async (req,res)=>{

    
    //will search for the exact phrase in the document of crawler
    var isPhraseSearch=false;
    
    //start time
    const start=Date.now();

    //the query is the whole string containing the words that the user is searching for
    var query=req.query.query;

    //check if the first character and the last character is a quotation mark
    if(query[0]==='"' && query[query.length-1]==='"')
    {
        //phrase search
        isPhraseSearch=true;    
        //remove the quotation marks from the query
        query=query.slice(1,query.length-1);
    }

    //pagination query parameters
    const page=parseInt(req.query.page);
    const limit=parseInt(req.query.limit) || 10; 

    ///////////////////////////////////////////////////////////////Suggestion addition///////////////////////////////////////////////

    //save the query in the database in collection called "Suggestions"
    //create the collection
    const existingQuery= await database.collection("Suggestions").findOne({query:query});
    if(existingQuery){
        //do nothing 
        console.log('A user searched for the same query before');
    }
    else{
        //save the query in the database
        //create the document
        try{
            //insert the query in the database
            await database.collection("Suggestions").insertOne({query:query});
            console.log('The query is saved in the suggestion database');
        }
        catch(error){
            console.log("Error in saving the query in the database");
        }

    }

    ///////////////////////////////////////////////////////////////Preprocessing on query///////////////////////////////////////////////

    ////////////////////////////////////////////////phrase search///////////////////////////////////////////////
    //case of phrase search
    if(isPhraseSearch){ 
        //remove stop words
        const stopWords=fs.readFileSync('StopWords.txt','utf8').split('\r\n');
        const query1=lodash.difference(query.split(' '),stopWords).join(' ');
        //lowercase
        const query2=query1.toLowerCase();

        //for Crawler collection in the database
        //search for the query in the value inside the Content field

        const foundDocuments=await database.collection("Crawler").find({Content:{$regex:`${query2}`}}).toArray();
        if (foundDocuments.length==0){
            console.log('No results found');
            return res.status(200).json({message:'No results found for this query'});
        }
        else{
            //initialize the response object
            const response={
                result:[],
                pagination:{},
                time:0
            };
            //pagination
            const startIndex=(page-1)*limit;
            const endIndex=page*limit;

            //slice the array
            const results=foundDocuments.slice(startIndex,endIndex);

            const totalResults=foundDocuments.length;
            const totalPages=Math.ceil(totalResults/limit);
    
            response.pagination.totalResults=totalResults;
            response.pagination.totalPages=totalPages;
            response.pagination.currentPage=page;
            response.pagination.nextPage=page < totalPages ? page + 1 : null,
            response.pagination.previousPage=page > 1 ? page - 1 : null

            //the foundDocuments format is an array of objects
            results.forEach(object => {
                var tempObject={};
                tempObject.URL=object.URL;
                tempObject.Title=object.Title;
                //find the index of the query in the content
                const index=object.Content.indexOf(query2);
                //take a snippet around the query
                //the snippet is 200 characters long
                //the snippet is centered around the query
                //check the cases of index
                if (index-400<0){
                    if(index+400<object.Content.length){
                        tempObject.Content=object.Content.slice(0,index+400);
                    }
                    else{
                        tempObject.Content=object.Content.slice(0,index);
                    }
                }
                else if(index+400>object.Content.length){
                    if(index-400>0){
                        tempObject.Content=object.Content.slice(index-400,index);
                    }
                }
                else{
                    tempObject.Content=object.Content.slice(index-400,index+400);
                }

                //push the tempObject to the response result array
                response.result.push(tempObject);
            });

            //send the response
            try{
                //end time
                const end=Date.now();
                response.time=parseFloat(((end-start)*0.001).toFixed(3));
                return res.status(200).json(response);
            }
            catch(error){
                console.log('Error in returning the response of this phrase search');
            }
            
        }

    }
    ////////////////////////////////////////////////regular search///////////////////////////////////////////////
    else
    {
        //case of not phrase search 
        //1- Remove all special characters and numbers using lodash
        const query1=lodash.replace(query, /[^a-zA-Z ]/g, "");

        //2- Remove all the stop words
        //the stop words are stored in a file called StopWords.txt
        //read the file, one word per line
        const stopWords=fs.readFileSync('StopWords.txt','utf8').split('\r\n');
        // console.log(stopWords);
        //remove the stop words from the query
        const query2=lodash.difference(query1.split(' '),stopWords).join(' ');


        //3- lowercase all the words
        const query3=query2.toLowerCase();

        //4- remove the duplicate words
        const query4=lodash.uniq(query3.split(' ')).join(' ');


        //5- split the query into words
        const queryWords=query4.split(' ');

        //6- Stemming
        // const stemmer = new EnglishStemmer();
        const stemmer = Snowball.newStemmer('english');
        const finalQueryWords =queryWords.map(word=>stemmer.stem(word));

        console.log(finalQueryWords);

        ///////////////////////////////////////////////////////////////Search the database///////////////////////////////////////////////
        const foundDocuments=[];
        //for every word in the query, search the database for the documents that contain this word
        //inside the the Indexer collection
        //search for the value in the Word field
        // if the word is found, push the FoundInDocs field array elements to the foundDocuments array
        // access the database
        for(let i=0;i<finalQueryWords.length;i++){
            const foundWord=await database.collection("Indexer").find({Word:finalQueryWords[i]}).toArray();
            // console.log(foundWord);

            
            if(foundWord.length>0){
                foundWord[0].FoundInDocs.forEach(object => {
                    //the object here in the indexer will only contain the url and the IDF_TF value
                    object.word=finalQueryWords[i];
                    foundDocuments.push(object);
                });    
            }


        }
        // console.log(foundDocuments);

        ///////////////////////////////////////////////////////////////Ranking the documents///////////////////////////////////////////////

        // TODO: Sort according to the IDF_TF value
        // convert the IDF_TF value to a number
        // sort the array of objects based on the IDF_TF value
        foundDocuments.sort((a,b)=>parseFloat(b.IDF_TF)-parseFloat(a.IDF_TF));


        ///////////////////////////////////////////////////////////////Return the results///////////////////////////////////////////////
        //initializing the response object
        const response={
            result:[],
            pagination:{},
            time:0
        };
        //pagination
        const startIndex=(page-1)*limit;
        const endIndex=page*limit;
        //slice the array
        const results=foundDocuments.slice(startIndex,endIndex);

        //in the Crawler collection in the database
        //TODO: change "Crawler" collection to "WebCrawler"

        //for every object in the results array, search the database for the document with the same URL
        //search for the URL in the URL field
        //will get the title and the snippet from the content of the document

        for(let i=0;i<results.length;i++)
        {
            //search for the URL in the database
            const foundDocument=await database.collection("Crawler").findOne({URL:results[i].URL});
            // the found document will contain the URL, Title, and Content fields
            var tempObject={};
            tempObject.URL=results[i].URL;
            tempObject.Title=foundDocument.Title;
            //find the index of the stemmed word in the content
            const index=foundDocument.Content.indexOf(results[i].word);
            //take a snippet around the query
            //the snippet is 400 characters long
            //the snippet is centered around the query
            //check the cases of index
            if (index-400<0){
                if(index+400<foundDocument.Content.length){
                    tempObject.Content=foundDocument.Content.slice(0,index+400);
                }
                else{
                    tempObject.Content=foundDocument.Content.slice(0,index);
                }
            }
            else if(index+400>foundDocument.Content.length){
                if(index-400>0){
                    tempObject.Content=foundDocument.Content.slice(index-400,index);
                }
            }
            else{
                tempObject.Content=foundDocument.Content.slice(index-400,index+400);
            }

            response.result.push(tempObject);
        }

        const totalResults=foundDocuments.length;
        const totalPages=Math.ceil(totalResults/limit);

        response.pagination.totalResults=totalResults;
        response.pagination.totalPages=totalPages;
        response.pagination.currentPage=page;
        response.pagination.nextPage=page < totalPages ? page + 1 : null,
        response.pagination.previousPage=page > 1 ? page - 1 : null

        //return the response
        try{
            //end time
            const end=Date.now();
            response.time=parseFloat(((end-start)*0.001).toFixed(3));
            return res.status(200).json(response);
        }
        catch(error){
            console.log('Error in returning the response');
        }
    }

});

//function to insert in crawler collection
//FOR TESTING ONLY
app.get('/insertInCrawler',async (req,res)=>{
    //get the request.body
    const body=req.body;
    //insert the body in the database
    try{
        await database.collection("Crawler").insertOne(body);
        console.log('The document is inserted in the crawler collection');
        res.status(200).json({message:'The document is inserted in the crawler collection'});
    }
    catch(error){
        console.log('Error in inserting the document in the crawler collection');
        res.status(500).json({message:'Error in inserting the document in the crawler collection'});
    }
});


//function to insert in indexer collection
//FOR TESTING ONLY
app.get('/insertInIndexer',async (req,res)=>{
    //get the request.body
    const body=req.body;
    //insert the body in the database
    try{
        await database.collection("Indexer").insertOne(body);
        console.log('The document is inserted in the indexer collection');
        res.status(200).json({message:'The document is inserted in the indexer collection'});
    }
    catch(error){
        console.log('Error in inserting the document in the indexer collection');
        res.status(500).json({message:'Error in inserting the document in the indexer collection'});
    }
});





