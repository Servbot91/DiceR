# DiceR
DiceR(oll) is an improvement on the original [Stash](https://stashapp.cc/) plugin [random button](https://discourse.stashapp.cc/t/randombutton/1809) written by MrDocSabio. 

## Features
1. **Random Item Selection:** 
    - DiceR fetches all IDs of the current entity type via GraphQL query. It'll then randomly sort and select. 
  
2. **Better Randomization**
    - Shuffles the IDs and selects the next random ID. Supercedes any sort bias when calling randomGlobal().
    - Uses localStorage to store shuffled ID lists and remaining IDs. A major improvement over the original which would inevitably show the same content session to session.
    - Once all items have been shown, the list reshuffles automatically.
    - Works globally (all Scenes, performers, etc.)
  
3. **New Content Handling**
    - It compares the freshly fetched list (`currentIds`) with the stored cache (`stored.allIds`) using `arraysEqual()`. **If the IDs have changed** (i.e., new content has been added or some items removed), the cache is considered invalid.
    - When the cache is invalid, a new shuffled list of IDs is created and the remaining list is reset so the new content is included in upcoming random selections.
    - DiceR still tracks which items have already been shown from the shuffled list thus preventing repeat selections.

### Credit
[random button](https://discourse.stashapp.cc/t/randombutton/1809) written by MrDocSabio. 
