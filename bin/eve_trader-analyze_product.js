const fs = require('fs');
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
const eve_market_database = nano.use('eve_market_logs');
const eve_meta_database = nano.use('eve_meta');
const eve_names_database = nano.use('eve_names');
const eve_universe_database = nano.use('eve_universe');

let item_param = process.argv[2];
let sec_type = process.argv[3];

let names_manifest = [];
let item_meta = [];
let item_manifest = [];
let systems_data = [];
let trading_manifest = [];
let planet_products_manifest = [
      '44',
    '2073',
    '2267',
    '2268',
    '2270',
    '2272',
    '2286',
    '2287',
    '2288',
    '2305',
    '2306',
    '2307',
    '2308',
    '2309',
    '2310',
    '2311',
    '2312',
    '2317',
    '2319',
    '2321',
    '2327',
    '2328',
    '2329',
    '2344',
    '2345',
    '2346',
    '2348',
    '2349',
    '2351',
    '2352',
    '2354',
    '2358',
    '2360',
    '2361',
    '2366',
    '2367',
    '2389',
    '2390',
    '2392',
    '2393',
    '2395',
    '2396',
    '2397',
    '2398',
    '2399',
    '2400',
    '2401',
    '2463',
    '2867',
    '2868',
    '2869',
    '2870',
    '2871',
    '2872',
    '2875',
    '2876',
    '3645',
    '3683',
    '3689',
    '3691',
    '3693',
    '3695',
    '3697',
    '3725',
    '3775',
    '3779',
    '3828',
    '9828',
    '9830',
    '9832',
    '9834',
    '9836',
    '9838',
    '9840',
    '9842',
    '9846',
    '9848',
    '12836',
    '15317',
    '17136',
    '17392',
    '17898',
    '28974'
  ];

let faurent02_source_manifest = [
  '2393',
  '2396',
  '3779',
  '2390',
  '3683',
  '2389',
  '2399',
  '2398',
  '3645',
  '15317',
  '2317',
  '2321'
];
// ---- MAIN FUNCTIONS -------------------------------------------------------//

const init = async () => {
  try{
    await eve_names_database.list({include_docs: true}).then(async (data) => {
      await data.rows.map(map_to_names, names_manifest);
    });
    await eve_meta_database.list({include_docs: true})
      .then(async (data) => {
        await data.rows.map(map_to_item_meta, item_meta);
    });
    await eve_universe_database.view('systems','list').then(async (data) => {
      await data.rows.map(map_to_systems, systems_data);
    });

    switch(item_param){
      case "all":
        console.log(`products: ${item_param}`);
        await eve_market_database.list({include_docs: false})
          .then(async (data) => {
            await data.rows.map(map_to_items_manifest, item_manifest);
        });
        break;

      case "planetary":
        console.log(`planetary: ${item_param}`);
        item_manifest = planet_products_manifest;
        break;

      case "faurent II":
        console.log(`faurent II: ${item_param}`);
        item_manifest = faurent02_source_manifest;
        break;

      default:
        console.log(`default: ${item_param}`);
        item_manifest.push(item_param);
        break;
    }

    switch(sec_type){
      case "lo_sec":
        sec_type = { lo_sec: true };
        break;

      case "hi_sec":
        sec_type = { hi_sec: true };
        break;
    }

  } catch(error){
    throw(error);
  }
}

async function fetch_market_manifest(){
  try{
    console.log(`Discovered ${item_manifest.length} items to analyze`);
    do{
      let items_to_analyze = (item_manifest.length <= 1000) ? item_manifest.splice(0,item_manifest.length) : item_manifest.splice(0,1000);
      await eve_market_database.fetch({keys: items_to_analyze})
        .then(async (data) => {
          for(fndx=0;fndx<data.rows.length;fndx++){
            let item_market = data.rows[fndx].doc;
            await analyze_market_data(item_market);
          }
        });
    } while(item_manifest.length > 0);
  } catch (error) {
    throw(error);
  }
}

async function analyze_market_data(item_market){
  try{
    // filter lo_sec transacations here
    if(sec_type.hi_sec){
      let hi_sec_supply = item_market.supply.filter(capture_hi_sec_transactions);
      item_market.supply = hi_sec_supply;
      let hi_sec_demand = item_market.demand.filter(capture_hi_sec_transactions);
      item_market.demand = hi_sec_demand;
    }

    // Supply & Demand Check
    let supply = item_market.supply.length;
    let demand = item_market.demand.length;
    //console.log(`Analyzing market for [ ${item_market.type_id} ] | Supply: ${supply} vs Demand: ${demand}`);
    let highest_bid = (demand > 0) ? item_market.demand[0].price : Number.MIN_SAFE_INTEGER;
    let lowest_price = (supply > 0) ? item_market.supply[0].price : Number.MAX_SAFE_INTEGER;
    let profit = highest_bid-lowest_price;
    // Profitable Items Only
    //console.log(`best profit: ${profit}`);

    //console.log(`item_market[${item_market.type_id}]`);
    let type_id = item_market.type_id;
    let name = (item_meta[type_id]) ? item_meta[type_id].name.en : "[Unknown]";
    let basePrice = (item_meta[type_id]) ? item_meta[type_id].basePrice : Number.MIN_SAFE_INTEGER;
    let profit_base = basePrice-lowest_price;
    let volume = (item_meta[type_id]) ? item_meta[type_id].volume : Number.MIN_SAFE_INTEGER;
    let qty_in_km3 = volume > 1000 ? 1 : Math.floor(1 + (1000 / volume));
    let base_margin = profit_base/lowest_price;
    let profit_margin = profit/lowest_price;
    let transactions = [];
    let transaction_log = [];
    let show_logs = false;
    console.log('');


    // Tally the market population, and extract the percentile orders of most use.
    let max_supply_price = 100 * lowest_price;
    let base_demand_price = highest_bid / 100;
    let supply_orders = await item_market.supply.filter(capture_viable_supplies, max_supply_price);
    let demand_orders = await item_market.demand.filter(capture_viable_demands, base_demand_price);
    console.log(`supply_orders.length: ${supply_orders.length}`);
    console.log(`demand_orders.length: ${demand_orders.length}`);

    let supply_population = await supply_orders.reduce(return_market_population, 0);
    let demand_population = await demand_orders.reduce(return_market_population, 0);
    console.log(`supply_population: ${supply_population}`);
    console.log(`demand_population: ${demand_population}`);

    let supply_magnitude = await supply_orders.reduce(return_market_magnitude, 0);
    let supply_mean = supply_magnitude / supply_population;
    let demand_magnitude = await demand_orders.reduce(return_market_magnitude, 0);
    let demand_mean = demand_magnitude / demand_population;
    console.log(`supply_mean: ${supply_mean}`);
    console.log(`demand_mean: ${demand_mean}`);

    let viable_supply = await supply_orders.filter(capture_viable_supplies, supply_mean);
    let viable_demand = await demand_orders.filter(capture_viable_demands, demand_mean);
    console.log(`viable_supply.length: ${viable_supply.length}`);
    console.log(`viable_demand.length: ${viable_demand.length}`);

    let viable_supply_population = await viable_supply.reduce(return_market_population, 0);
    let viable_demand_population = await viable_demand.reduce(return_market_population, 0);
    console.log(`viable_supply_population: ${viable_supply_population}`);
    console.log(`viable_demand_population: ${viable_demand_population}`);

    let viable_supply_magnitude = await viable_supply.reduce(return_market_magnitude, 0);
    let viable_supply_mean = viable_supply_magnitude / viable_supply_population;
    let viable_demand_magnitude = await viable_demand.reduce(return_market_magnitude, 0);
    let viable_demand_mean = viable_demand_magnitude / viable_demand_population;
    console.log(`viable_supply_mean: ${viable_supply_mean}`);
    console.log(`viable_demand_mean: ${viable_demand_mean}`);

    let select_supply = await viable_supply.filter(capture_viable_supplies, viable_supply_mean);
    let select_demand = await viable_demand.filter(capture_viable_demands, viable_demand_mean);
    console.log(`select_supply.length: ${select_supply.length}`);
    console.log(`select_demand.length: ${select_demand.length}`);

    let select_supply_population = await select_supply.reduce(return_market_population, 0);
    let select_demand_population = await select_demand.reduce(return_market_population, 0);
    console.log(`select_supply_population: ${select_supply_population}`);
    console.log(`select_demand_population: ${select_demand_population}`);

    let select_supply_magnitude = await select_supply.reduce(return_market_magnitude, 0);
    let select_supply_mean = select_supply_magnitude / select_supply_population;
    let select_demand_magnitude = await select_demand.reduce(return_market_magnitude, 0);
    let select_demand_mean = select_demand_magnitude / select_demand_population;
    console.log(`select_supply_mean: ${select_supply_mean}`);
    console.log(`select_demand_mean: ${select_demand_mean}`);

    await select_supply.sort(sort_supply_orders_by_price);
    await select_demand.sort(sort_demand_orders_by_price);

    let highest_select_supply = (select_supply.length > 0) ? select_supply[select_supply.length-1].price : Number.MAX_SAFE_INTEGER;
    let lowest_select_supply = (select_supply.length > 0) ? select_supply[0].price : Number.MAX_SAFE_INTEGER;
    let select_supply_margin = highest_select_supply - lowest_select_supply;
    let select_supply_variance = select_supply_margin / highest_select_supply;
    console.log(`highest_select_supply: ${highest_select_supply}`);
    console.log(`lowest_select_supply: ${lowest_select_supply}`);

    let highest_select_demand = (select_demand.length > 0) ? select_demand[0].price : Number.MIN_SAFE_INTEGER;
    let lowest_select_demand = (select_demand.length > 0) ? select_demand[select_demand.length-1].price : Number.MIN_SAFE_INTEGER;
    let select_demand_margin = highest_select_demand - lowest_select_demand;
    let select_demand_variance = select_demand_margin / highest_select_demand;
    console.log(`highest_select_demand: ${highest_select_demand}`);
    console.log(`lowest_select_demand: ${lowest_select_demand}`);


    console.log("|---------------------------------------------------------------------------------------|");
    console.log(`| [ ${type_id} ]\t ${name}`);
    console.log(`|\tVolume: ${volumetricFormat(volume)}\t${qty_in_km3} @ ${volumetricFormat(volume)} = ${volumetricFormat((qty_in_km3) * volume)}`);
    console.log(`| Total: ${supply_orders.length} supply & ${demand_orders.length} demand orders`);
    console.log("|---------------------------------------------------------------------------------------|");
    console.log(`| Select: ${select_supply.length} supply & ${select_demand.length} demand orders`);
    console.log(`| High Supply: ${currencyFormat(highest_select_supply)} - Lowest Supply: ${currencyFormat(lowest_select_supply)} = ${currencyFormat(select_supply_margin)}(${percentageFormat(select_supply_variance)})`);
    console.log(`| High Demand: ${currencyFormat(highest_select_demand)} - Lowest Demand: ${currencyFormat(lowest_select_demand)} = ${currencyFormat(select_demand_margin)}(${percentageFormat(select_demand_variance)})`);
    console.log("|---------------------------------------------------------------------------------------|");
    console.log("|");
    console.log('| [ Supply Orders ]');
    console.log("|");
    let tallied_supply_orders = 0;
    let trading_manifest_record = {type_id: type_id, buyer: select_demand_mean, seller: select_supply_mean};
    for(sndx=0; sndx < select_supply.length && tallied_supply_orders <= 15; sndx++){
      let supply_order = select_supply[sndx];
      if(sndx==0) {
        //trading_manifest_record.seller = supply_order.price;
      }
      supply_order.low_sec = (systems_data[supply_order.system_id].security_status < 0.5);
      if(!supply_order.low_sec || sec_type.lo_sec) {
        try{
          console.log(`|\t${numberFormat(0, supply_order.volume_remain)}   @   ${currencyFormat(supply_order.price)}\tfrom\t${names_manifest[supply_order.system_id].name}\t[ ${names_manifest[supply_order.region_id].name} ]`);
          tallied_supply_orders++;
        } catch(err){}
      }
    }
    console.log("|");
    console.log('| [ Purchase Orders ]');
    console.log("|");
    let max_demand_orders = Math.min(demand_orders.length,15);
    let tallied_demand_orders = 0;
    for(dndx=0; dndx < select_demand.length && tallied_demand_orders <= 15; dndx++){
      let demand_order = select_demand[dndx];
      if(dndx==0) {
        //trading_manifest_record.buyer = demand_order.price;
      }
      demand_order.low_sec = (systems_data[demand_order.system_id].security_status < 0.5);
      if(!demand_order.low_sec || sec_type.lo_sec) {
        try{
          console.log(`|\t${numberFormat(0, demand_order.volume_remain)}   @   ${currencyFormat(demand_order.price)}\tfrom\t${names_manifest[demand_order.system_id].name}\t[ ${names_manifest[demand_order.region_id].name} ]`);
          tallied_demand_orders++;
        } catch(err){}
      }
    }
    trading_manifest.push(trading_manifest_record);
    console.log("|---------------------------------------------------------------------------------------|");
  } catch(err){
    throw(err);
  } finally{

  }
}

async function create_report(){
  let manifest_timestamp = new Date().getTime();
  var csv = await trading_manifest.map(function(d){
      return JSON.stringify(Object.values(d));
  }).join('\n').replace(/(^\[)|(\]$)/mg, '');

  await fs.writeFile(`C:/Phox.Solutions/products/eve_trader/reports/planetary_market_data_${manifest_timestamp}.csv`,csv, async (err) => {
    if(err) throw err;
    console.log(`planetary_market_data_${manifest_timestamp}.csv  |  ${(err)?"Failed":"Successful!"}`);
    return;
  });
}
// ---- SUB-ROUTINE FUNCTIONS ------------------------------------------------//

function capture_hi_sec_transactions(order){
  return(systems_data[order.system_id].security_status >= 0.5);
}

function capture_viable_supplies(supply_order){
  return (supply_order.price <= this);
}

function capture_viable_demands(demand_order){
  return (demand_order.price >= this);
}

function extract_type_ids(item){
    return(item.id);
}

function map_to_items_manifest(item){
  if(!isNaN(Number(item.id))){
    this.push(item.id);
  }
}

function map_to_item_meta(item){
    this[item.id] = item.doc;
}

function map_to_names(item){
  this[item.id] = { name: item.doc.name };
}

function map_to_systems(item){
  this[item.id] = item.value;
}

function map_to_market_manifest(item){
    this[item.doc.type_id] = item.doc;
}

function return_market_population(soFar, currOrder){
  return soFar + currOrder.volume_remain;
}

function return_market_magnitude(soFar, currOrder){
  //console.log(soFar + (currOrder.price * currOrder.volume_remain));
  return soFar + (currOrder.price * currOrder.volume_remain);
}

function numberFormat(places, num) {
  return num.toFixed(places).replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,');
}

function currencyFormat(num) {
  return num.toFixed(2).replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,') + ' ISK';
}

function percentageFormat(num) {
  return (num*100).toFixed(2).replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,') + '%';
}

function volumetricFormat(num){
  return num.toFixed(2).replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,') + ' m3';
}

function filter_profitable_demands(demand){
  return (demand.price>this);
}

function filter_profitable_supplies(supply){
  return(supply.price<this);
}

function sort_supply_orders_by_price(a, b){
  return (a.price<b.price) ? -1 : (a.price>b.price) ? 1 : 0;
}

function sort_demand_orders_by_price(a, b){
  return (a.price<b.price) ? 1 : (a.price>b.price) ? -1 : 0;
}

// ---- SCRIPT LOGIC ---------------------------------------------------------//

init()
  .then(fetch_market_manifest)
  .then(create_report)
  .catch((error) => {throw(error)});
