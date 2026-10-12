
## BLURT-CONNECT RUN · 2026-10-11T14:29:19.030Z

| at | op | detail | status |
|---|---|---|---|
| 2026-10-11T14:29:18.364Z | config | chain_id=… head_block=64394728 | ok |
| 2026-10-11T14:29:18.655Z | account_update | @cornerstone broadcast refused: signed_transaction.operations	 cause: account_update.owner	 cause: authority.account_auths	 cause: v | no-authority-or-error |
| 2026-10-11T14:29:19.030Z | account_update | @owner broadcast refused: signed_transaction.operations	 cause: account_update.owner	 cause: authority.account_auths	 cause: v | no-authority-or-error |
| 2026-10-11T14:29:19.030Z | summary | no account accepts BLURT_ACTIVE_WIF — key-account mapping unknown; owner must map the secret | RED-UNKNOWN-MAPPING |


## BLURT-CONNECT RUN · 2026-10-11T14:43:33.876Z

| at | op | detail | status |
|---|---|---|---|
| 2026-10-11T14:43:33.139Z | config | chain_id=cd8d90f29a… (official blurtjs config) | ok |
| 2026-10-11T14:43:33.724Z | census | @cornerstone no candidate secret matches live active authority | refused |
| 2026-10-11T14:43:33.876Z | account_update | @owner broadcast refused: request to https://rpc.blurt.world failed, reason: getaddrinfo ENOTFOUND rpc.blurt.world | no-authority-or-error |
| 2026-10-11T14:43:33.876Z | summary | no blurt account connected this run — census lines above say exactly which secrets were tried | RED-UNCONNECTED |


## BLURT-CONNECT RUN · 2026-10-11T14:47:49.152Z

| at | op | detail | status |
|---|---|---|---|
| 2026-10-11T14:47:48.171Z | config | chain_id=cd8d90f29a… (official blurtjs config) | ok |
| 2026-10-11T14:47:48.690Z | census | @cornerstone no candidate secret matches live active authority | refused |
| 2026-10-11T14:47:49.152Z | account_update | @owner broadcast refused: transaction.operations = account_update,[object Object] cause: account_update.posting_json_metadata = undefined cause: v | no-authority-or-error |
| 2026-10-11T14:47:49.152Z | summary | no blurt account connected this run — census lines above say exactly which secrets were tried | RED-UNCONNECTED |


## BLURT-CONNECT RUN · 2026-10-11T14:49:37.789Z

| at | op | detail | status |
|---|---|---|---|
| 2026-10-11T14:49:36.841Z | config | chain_id=cd8d90f29a… (official blurtjs config) | ok |
| 2026-10-11T14:49:37.301Z | census | @cornerstone no candidate secret matches live active authority | refused |
| 2026-10-11T14:49:37.777Z | account_update | @owner broadcast refused: missing required owner authority:Missing Owner Authority owner | no-authority-or-error |
| 2026-10-11T14:49:37.777Z | summary | no blurt account connected this run — census lines above say exactly which secrets were tried | RED-UNCONNECTED |


## BLURT-CONNECT RUN · 2026-10-11T14:52:00.710Z

| at | op | detail | status |
|---|---|---|---|
| 2026-10-11T14:51:59.067Z | config | chain_id=cd8d90f29a… (official blurtjs config) | ok |
| 2026-10-11T14:51:59.902Z | census | @cornerstone no candidate secret matches live active authority | refused |
| 2026-10-11T14:52:00.710Z | account_update | @owner broadcast refused: Assert Exception:acnt.balance >= fee: Account does not have sufficient funds for transaction fee. | no-authority-or-error |
| 2026-10-11T14:52:00.710Z | summary | no blurt account connected this run — census lines above say exactly which secrets were tried | RED-UNCONNECTED |


## BLURT-CONNECT RUN · 2026-10-11T16:26:16.019Z

| at | op | detail | status |
|---|---|---|---|
| 2026-10-11T16:26:14.657Z | config | chain_id=cd8d90f29a… (official blurtjs config) | ok |
| 2026-10-11T16:26:15.377Z | census | @cornerstone no candidate secret matches live active authority | refused |
| 2026-10-11T16:26:16.019Z | account_update | @owner signature ACCEPTED but blurt charges an account_update fee above liquid balance — funding gap, not a machine failure (provision: fund the account or set the cornerstone active key) | BLUE-NEEDS-FUNDING |


## BLURT-CONNECT RUN · 2026-10-12T13:20:28.291Z

| at | op | detail | status |
|---|---|---|---|
| 2026-10-12T13:20:28.085Z | config | chain_id=cd8d90f29a… (official blurtjs config) | ok |
| 2026-10-12T13:20:28.291Z | fatal | Unexpected token 'S', "Server is "... is not valid JSON | RED-FATAL |

