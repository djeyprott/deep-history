# Builds an approximate Earth heightmap on a 240x120 (1.5 deg) grid.
import numpy as np, json, math
from global_land_mask import globe
W,H=240,120
lats=np.array([90-(j+0.5)*180/H for j in range(H)])
lons=np.array([-180+(i+0.5)*360/W for i in range(W)])
# land fraction with 4x4 subsamples
frac=np.zeros((H,W))
for dy in range(4):
  for dx in range(4):
    la=90-(np.arange(H)+(dy+0.5)/4)*180/H
    lo=-180+(np.arange(W)+(dx+0.5)/4)*360/W
    LO,LA=np.meshgrid(lo,la)
    frac+=globe.is_land(LA,LO)
frac/=16
land=frac>=0.4
# distance to coast (in cells) for land and ocean, BFS
from collections import deque
def dist(mask):
  d=np.full((H,W),999); q=deque()
  for j in range(H):
    for i in range(W):
      if not mask[j,i]: d[j,i]=0; q.append((j,i))
  while q:
    j,i=q.popleft()
    for dj,di in ((1,0),(-1,0),(0,1),(0,-1)):
      jj,ii=j+dj,(i+di)%W
      if 0<=jj<H and d[jj,ii]>d[j,i]+1: d[jj,ii]=d[j,i]+1; q.append((jj,ii))
  return d
dl=dist(land); do=dist(~land)
elev=np.where(land,120+np.minimum(dl,12)*25.0,-4000.0)
elev=np.where(~land,np.where(do==1,-70,np.where(do==2,-160,np.where(do<=4,-1500,-4000))),elev)
def cell(lat,lon): return int((90-lat)/1.5), int(((lon+180)%360)/1.5)
def gauss_add(lat,lon,h,r,mode='max'):
  for j in range(H):
    for i in range(W):
      if not land[j,i]: continue
      dlat=lats[j]-lat; dlon=((lons[i]-lon+180)%360-180)*math.cos(math.radians(lat))
      d2=(dlat*dlat+dlon*dlon)/(r*r)
      if d2<9:
        v=h*math.exp(-d2*d2) if mode=='plateau' else h*math.exp(-d2)
        if mode in('max','plateau'): elev[j,i]=max(elev[j,i],v)
        else: elev[j,i]+=v
def ridge(pts,h,r):
  for (a,b),(c,d) in zip(pts,pts[1:]):
    n=max(2,int(math.hypot(c-a,d-b)/0.75))
    for k in range(n+1):
      t=k/n; gauss_add(a+(c-a)*t,b+(d-b)*t,h,r)
# plateaus (lat,lon,height,radius deg)
for p in [(33,88,4800,7),(33.5,81,4500,3.0),(35,95,4300,5),(-17,-68,3800,3.5),(9,39,2300,4),(32,55,1300,6),(23,-102,1900,4),(38,-110,2000,6),(18,77,600,6),(-15,-48,900,9),(-2,36,1300,6),(-25,25,1200,8),(44,103,1400,9),(39,35,1100,4),(40,-4,700,3),(-27,135,300,8),(72,-40,2200,7),(64,-43,1800,5),(-80,0,2800,25),(-75,120,3000,20),(13,45,1200,3),(-20,47,1000,3)]:
  gauss_add(p[0],p[1],p[2],p[3],'plateau')
ranges=[
 ([(46,6),(47,10),(47,14)],3200,1.2),            # Alps
 ([(43,-1),(42.5,2)],2400,1.0),                  # Pyrenees
 ([(43,40),(42,46),(40,50)],3400,1.2),           # Caucasus/Alborz
 ([(35.5,74),(33,77),(30,81),(28.3,86),(27.8,92),(28,97)],6000,1.1), # Himalaya/Karakoram
 ([(37,63),(39,70),(42,78),(43,86)],3800,1.6),   # Pamir/Tian Shan
 ([(48,88),(50,96)],2800,1.5),                   # Altai
 ([(60,59),(52,58)],1200,1.0),                   # Urals
 ([(32,-6),(35,4),(36,9)],2600,1.2),             # Atlas
 ([(60,-140),(55,-128),(49,-117),(40,-108),(35,-106)],3200,2.2), # Rockies
 ([(48,-121),(42,-121.5),(37,-119)],2000,0.8),     # Cascades/Sierra
 ([(45,-70),(40,-77),(35,-83)],800,1.2),        # Appalachians
 ([(10,-74),(0,-78),(-10,-76),(-20,-69),(-33,-70),(-45,-72),(-53,-72)],4800,1.4), # Andes
 ([(37,28),(37,36),(38,42)],2600,1.3),           # Taurus/Zagros start
 ([(35,46),(30,52),(27,57)],2700,1.4),           # Zagros
 ([(-3,30),(-9,33)],2000,1.5),                   # Albertine rift
 ([(-30,148),(-37,148)],1300,1.2),               # Great Dividing
 ([(36,138),(43,143)],2000,0.9),                 # Japan
 ([(64,-148),(62,-150)],3500,1.5),               # Alaska range
 ([(62,8),(68,16)],1300,1.2),                    # Scandes
 ([(46,24),(48,22),(46,26)],1800,1.0),           # Carpathians
 ([(42,22),(40,22)],2000,1.0),                   # Balkans
 ([(-28,29),(-32,27)],2500,1.0),                 # Drakensberg
 ([(28,103),(25,102),(20,100)],3000,1.5),        # Hengduan / SE Asia
 ([(-5,140),(-6,146)],3500,1.2),                 # New Guinea
 ([(-43,171),(-45,168)],2500,0.9),               # NZ alps
]
for pts,h,r in ranges: ridge(pts,h,r)
# shelves that emerged at glacial lowstand
def setshelf(lat0,lat1,lon0,lon1,depth):
  for j in range(H):
    for i in range(W):
      if lat0<=lats[j]<=lat1 and lon0<=lons[i]<=lon1 and not land[j,i] and elev[j,i]>-1000:
        elev[j,i]=max(elev[j,i],depth)
      if lat0<=lats[j]<=lat1 and lon0<=lons[i]<=lon1 and not land[j,i] and do[j,i]<=6:
        elev[j,i]=max(elev[j,i],depth)
setshelf(-8,7,95,118,-55)     # Sunda
setshelf(-12,-8,128,142,-60)  # Arafura / Sahul
setshelf(-42,-38,143,149,-55) # Bass strait
setshelf(62,68,-178,-163,-50) # Bering
setshelf(62,68,175,180,-50)
setshelf(51,58,-4,9,-45)      # Doggerland
setshelf(31,41,117,126,-50)   # Yellow sea
setshelf(24,30,48,56,-50)     # Persian gulf
setshelf(-52,-40,-68,-58,-90) # Patagonia
setshelf(9,22,99,110,-60)     # Gulf of Thailand / S China shelf
# carve major river valleys (source -> mouth) so drainage basins are realistic
rivers=[
 [(-15,-72),(-10,-73),(-4,-70),(-3,-60),(-2,-54),(-0.5,-50)],            # Amazon
 [(-2,30),(4,32),(12,33),(15.5,32.5),(19,33),(24,32.9),(30,31.2),(31.3,30.5)], # Nile
 [(39,39),(36,38.5),(34,42),(31,46.5),(30,48)],                           # Euphrates
 [(38,43),(36,43),(33.3,44.4),(31,47.5)],                                 # Tigris
 [(33,79),(35,75),(33,72),(30,71),(27,68),(24,67.5)],                     # Indus
 [(31,79),(29,79.5),(26,82),(25.5,85),(24,88.5),(22,90)],                 # Ganges
 [(33,95),(30,99),(27,101),(28,104),(30.5,108),(30.5,114),(31.5,121)],    # Yangtze
 [(35,96),(36,103),(40,107),(39,111),(35,110.5),(34.8,113.5),(37.5,118.8)], # Yellow
 [(47,-95),(41,-91),(37,-89.2),(32,-91),(29,-89.3)],                      # Mississippi
 [(47,-112),(46,-104),(41,-96),(39,-92),(38.8,-90.2)],                    # Missouri
 [(-11,27),(-5,26),(1,23),(1,18),(-4,15),(-6,12.3)],                      # Congo
 [(9,-10),(14,-4),(16,0),(12,4),(8,6),(5,6)],                             # Niger
 [(48,9),(48,16),(47,19),(45,20),(44,25),(45.2,29.6)],                    # Danube
 [(57,33),(56,44),(55,49),(52,47),(48,45),(46,48)],                       # Volga
 [(50,87),(55,82),(60,77),(62,68),(66,66.5)],                             # Ob
 [(51,94),(56,92),(61,90),(66,87),(71,83)],                               # Yenisei
 [(53,108),(57,111),(60,120),(62,129),(66,124),(72,127)],                 # Lena
 [(32,96),(25,100),(20,101),(15,105),(10,106)],                           # Mekong
 [(-12,22),(-16,24),(-17.9,25.8),(-16,30),(-18.5,36)],                    # Zambezi
 [(-36,148),(-35,144),(-34,140),(-35.5,139)],                             # Murray
 [(47,9),(49,8.4),(51,6.7),(52,4.5)],                                     # Rhine
 [(-17,-56),(-24,-57),(-28,-59),(-33,-58.5),(-34.5,-58)],                 # Parana
 [(3,-65),(6,-67),(8,-64),(8.5,-61)],                                     # Orinoco
 [(62,-115),(65,-125),(68,-134)],                                         # Mackenzie
 [(50,127),(48,134),(52,138),(53,140.5)],                                 # Amur
]
for pts in rivers:
  seg=[]
  for (a,b),(c,d) in zip(pts,pts[1:]):
    n=max(2,int(math.hypot(c-a,d-b)/0.4))
    for k in range(n): seg.append((a+(c-a)*k/n,b+(d-b)*k/n))
  seg.append(pts[-1])
  L=len(seg)
  for k,(a,b) in enumerate(seg):
    j,i=int((90-a)/1.5),int(((b+180)%360)/1.5)
    if not land[j,i]: continue
    target=8+(L-1-k)/(L-1)*450
    elev[j,i]=min(elev[j,i],target)
elev=np.round(elev).astype(int)
json.dump({'W':W,'H':H,'elev':elev.flatten().tolist()},open('data/earth.json','w'))
print('land cells',int(land.sum()))
