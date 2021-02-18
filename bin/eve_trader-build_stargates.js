const https = require('https');
const agentkeepalive = require('agentkeepalive');
const nano = require('nano')({
    "url": "http://phx:c002n68r7507@localhost:5984",
    "requestDefaults": {
        "agent": new agentkeepalive({
            maxSockets: 50,
            maxKeepAliveRequests: 0,
            maxKeepAliveTime: 30000
        })
    }
});
let eve_names_database, eve_universe_database;
let stargates_index = [];
let names_manifest = [];
let stargate_profiles = [];

// -- MAIN FUNCTIONS ------------------------------------------

const init = async () => {
  try{
    eve_names_database = nano.use('eve_names');
    await eve_names_database.list({include_docs: true})
      .then(async (data) => {
        await data.rows.map(map_to_names, names_manifest);
    });

    eve_universe_database = nano.use('eve_universe');
    await eve_universe_database.view('stargates','source').then(async (data) =>{
      //console.log(`data: ${data}`);
      if(data){
        stargates_index = await data.rows.map(map_to_stargates_index);
      }
    });
  } catch(error){
    throw(error);
  }
}

const fetch_stargate_profiles = async _ => {
  try{
    const fetch_stargate_profile = async (stargate_id) => {
      return new Promise((resolve, reject) => {
        let api_url = "https://esi.evetech.net/latest/universe/stargates/" + stargate_id +"/?datasource=tranquility";

        https.get(api_url, (res) => {
          let data = '';
          res.on('data', (chunk) => {data += chunk});
          res.on('error', reject);
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode <= 299) {
              let stargate_profile = JSON.parse(data);
              stargate_profile._id = stargate_profile.stargate_id.toString();
              stargate_profile.type = "stargate";
              stargate_profiles[stargate_profile.stargate_id] = stargate_profile;
              console.log(`System id:(${stargate_id}) "${names_manifest[stargate_id].name}" profile has been fetched.`);
              resolve();
            } else {
              reject('Request failed. status: ' + res.statusCode + ', body: ' + data);
            }
          });
        });
      });
    }

    let promised_fetches = [];
    for(ndx = 0; ndx < stargates_index.length; ndx++){
      let stargate_id = stargates_index[ndx];
      let fetch_promise = fetch_stargate_profile(stargate_id)
        .catch(async (err) => console.error(err));
      console.log(`fetching: ${stargate_id}...`);
      promised_fetches.push(fetch_promise);
    }
    return Promise.all(promised_fetches);
  } catch (error) {
    throw(error);
  }
}

const save_stargate_profiles = async _ => {
  try{
    const save_stargate_profile = async (stargate_profile) => {
      try{
        //console.log(`stargate_profile: ${stargate_profile}`);
        return eve_universe_database.insert(stargate_profile, function (err, data) {
            if(err) throw(err);
        });
      } catch(error) {
        throw(error);
      }
    }

    await eve_universe_database.view('stargates','manifest').then(async (data) =>{
      //console.log(`data: ${data}`);
      if(data){
        await data.rows.map(map_to_existing_records, stargate_profiles);
      }
    });

    stargate_profiles = await stargate_profiles.filter(remove_empties);

    let promised_saves = [];
    for(ndx = 0; ndx < stargate_profiles.length; ndx++){
      let stargate_profile = stargate_profiles[ndx];
      let save_promise = save_stargate_profile(stargate_profile)
        .catch(async (err) => console.error(err));
      console.log(`saving id:(${stargate_profile._id})...`);
      promised_saves.push(save_promise);
    }
    return Promise.all(promised_saves);

  } catch(error) {
    throw(error);
  }
}

// -- SUB-ROUTINES --------------------------------------------

function map_to_names(item){
  this[item.id] = { name: item.doc.name };
}

function map_to_existing_records(stargate){
  console.log(stargate);
  if(this[stargate.id]) this[stargate.id]._rev = stargate.key.toString();
}

function map_to_stargates_index(stargate){
  return stargate.key;
}

function remove_empties(item){
    return(item != null);
}

// -- SCRIPT LOGIC --------------------------------------------

init()
  .then(fetch_stargate_profiles)
  .then(save_stargate_profiles)
  .catch((err) => { console.log(`to err is \n\n  ${err}\n\n ...human.`)});
