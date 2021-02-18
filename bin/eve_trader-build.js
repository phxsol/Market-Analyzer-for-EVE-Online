const fs = require('fs');
const YAML = require('yaml');
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

let build_names = false; let build_types = false;
let yaml_file, meta_name, set_size;
let what_to_build = process.argv[2].toLowerCase();
switch(what_to_build){
  case 'names':
    build_names = true;
    yaml_file = 'invNames.yaml';
    meta_name = 'names';
    db = 'eve_names';
    set_size = 1000;
    break;
  case 'types':
    build_types = true;
    yaml_file = 'typeIDs.yaml';
    meta_name = 'types';
    db = 'eve_meta';
    set_size = 100;
    break;
  default:
    console.log('Improper parameters provided, please persist.');
    process.exit(1);
    break;
}

const eve_meta_database = nano.use(db);
console.log(`reading ${yaml_file}`);
let YAML_file = fs.readFileSync(`../datasets/${yaml_file}`, 'utf8');
console.log('parsing YAML document');
let YAML_doc = YAML.parseDocument(YAML_file);
delete YAML_file;
console.log('converting to JSON');
let json_doc = YAML_doc.toJSON();
delete YAML_doc;
let datasets = [];

if(build_types){
  for (const prop in json_doc) {
    if (json_doc.hasOwnProperty(prop)) {
      let dataset = json_doc[prop];
        dataset._id = prop;
        datasets.push(dataset);
        console.log(`converted ${prop}`);
    }
  }
}

if(build_names){
  for (const prop in json_doc) {
    if (json_doc.hasOwnProperty(prop)) {
      let dataset = {
        _id: json_doc[prop].itemID.toString(),
        name: json_doc[prop].itemName
      }
      datasets.push(dataset);
    }
  }
}

delete json_doc;
console.log('cleaning up artifacts');
let dataset_count = datasets.length;
let dataset_chunks = [];
console.log(`chunking bits | ${datasets.length} datasets`);
while(datasets.length>0){
	let max_length = Math.min(set_size, datasets.length);
	let chunk = datasets.splice(0,max_length);
	console.log(`max_length: ${max_length} | Chunk size: ${chunk.length} datasets | ${datasets.length} datasets to go!`);
	dataset_chunks.push(chunk);
}
console.log(`${datasets.length} datasets left in original array`);
delete datasets;
let chunk_count = dataset_chunks.length;
console.log(`saving ${dataset_count} datasets from ${chunk_count} chunks to database`);

let active_updates = 0;
let successful_updates = 0;
let failed_updates = [];
let failures = 0;
let active_record;
update_records(true);
async function update_records(move_to_next){
  try{
    active_record = (move_to_next) ? dataset_chunks.pop() : active_record;
    if(typeof active_record !== 'undefined'){
      await eve_meta_database.bulk({docs: active_record}, function (err, data) {
          if(err){
              throw(err);
              failures++;
              if(failures>=5)
              {
                failures = 0;
                console.error(err);
                failed_updates.push(active_record);
                update_records(true);
              }
              console.log("Err attempting to record, trying again.");
              update_records(false);
          } else {
              successful_updates++;
              console.log(`Successful Update! ${successful_updates} so far!  |  ${active_updates}`);
              update_records(true);
          }
      });
    } else {
      if(failed_updates.length > 0){
          console.log(`Record Updates | Flawed: ${successful_updates} | Failures: ${failed_updates.length}`);
          console.log(failed_updates);
      } else {
          console.log(`Record Updates | Successful: ${successful_updates}`);
      }
    }
  } catch(error) {
    throw(error)
  }

}
