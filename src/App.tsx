import { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  Camera, 
  Upload, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  Info, 
  ArrowRight,
  UtensilsCrossed,
  ShieldCheck,
  Zap,
  Calculator,
  Scan,
  Search,
  ChevronRight,
  LogIn,
  LogOut,
  User as UserIcon,
  History
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User
} from 'firebase/auth';
import { auth, db } from './lib/firebase';
import { doc, setDoc, collection, query, where, getDocs, orderBy, limit, serverTimestamp } from 'firebase/firestore';

// Initialize Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface AnalysisResult {
  foodName: string;
  healthScore: number; // 0-100
  calories: string;
  ingredients: string[];
  pros: string[];
  cons: string[];
  recommendation: string;
  isSafe: boolean;
}

type Tab = 'food' | 'bmi' | 'search' | 'history';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('food');
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Food Analysis State
  const [image, setImage] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // BMI State
  const [weight, setWeight] = useState<string>('');
  const [height, setHeight] = useState<string>('');
  const [bmiResult, setBmiResult] = useState<{ value: number; category: string; color: string } | null>(null);

  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<AnalysisResult | null>(null);

  // History State
  const [history, setHistory] = useState<(AnalysisResult & { id: string; timestamp: any })[]>([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
      if (currentUser) {
        // Save/Update user profile
        setDoc(doc(db, 'users', currentUser.uid), {
          uid: currentUser.uid,
          email: currentUser.email,
          displayName: currentUser.displayName,
          photoURL: currentUser.photoURL,
          createdAt: serverTimestamp() 
        }, { merge: true });
      }
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setHistory([]);
      if (activeTab === 'history') setActiveTab('food');
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const fetchHistory = async () => {
    if (!user) return;
    try {
      const q = query(
        collection(db, 'users', user.uid, 'history'),
        orderBy('timestamp', 'desc'),
        limit(10)
      );
      const querySnapshot = await getDocs(q);
      const historyData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as any;
      setHistory(historyData);
    } catch (err) {
      console.error("Error fetching history:", err);
    }
  };

  useEffect(() => {
    if (activeTab === 'history' && user) {
      fetchHistory();
    }
  }, [activeTab, user]);

  const saveToHistory = async (data: AnalysisResult) => {
    if (!user) return;
    const historyRef = collection(db, 'users', user.uid, 'history');
    await setDoc(doc(historyRef), {
      ...data,
      userId: user.uid,
      timestamp: serverTimestamp()
    });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImage(reader.result as string);
        setResult(null);
        setError(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const analyzeFood = async () => {
    if (!image) return;
    setAnalyzing(true);
    setError(null);

    try {
      const base64Data = image.split(',')[1];
      const response = await ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: {
          parts: [
            {
              inlineData: {
                data: base64Data,
                mimeType: "image/jpeg",
              },
            },
            {
              text: "Analyze this food item. Provide information in English, and use the following JSON schema. Ensure the analysis is strictly based on what is visible in the image.",
            },
          ],
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              foodName: { type: Type.STRING, description: "Name of the food" },
              healthScore: { type: Type.NUMBER, description: "Health score from 0 to 100" },
              calories: { type: Type.STRING, description: "Estimated calories" },
              ingredients: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING },
                description: "List of ingredients"
              },
              pros: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING },
                description: "Health benefits"
              },
              cons: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING },
                description: "Health risks or warnings"
              },
              recommendation: { type: Type.STRING, description: "Final recommendation" },
              isSafe: { type: Type.BOOLEAN, description: "True if generally safe to eat" }
            },
            required: ["foodName", "healthScore", "calories", "ingredients", "pros", "cons", "recommendation", "isSafe"]
          },
        },
      });

      const data = JSON.parse(response.text);
      setResult(data);
      if (user) {
        saveToHistory(data);
      }
    } catch (err) {
      console.error(err);
      setError("Sorry, an error occurred while analyzing the food. Please try again.");
    } finally {
      setAnalyzing(false);
    }
  };

  const searchFood = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchResult(null);
    setError(null);

    try {
      const response = await ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: {
          parts: [
            {
              text: `Search for this food item and provide its nutritional information: "${searchQuery}". Use the following JSON schema.`,
            },
          ],
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              foodName: { type: Type.STRING, description: "Name of the food" },
              healthScore: { type: Type.NUMBER, description: "Health score from 0 to 100" },
              calories: { type: Type.STRING, description: "Estimated calories per standard serving" },
              ingredients: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING },
                description: "Common ingredients"
              },
              pros: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING },
                description: "Health benefits"
              },
              cons: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING },
                description: "Health risks or warnings"
              },
              recommendation: { type: Type.STRING, description: "Final recommendation" },
              isSafe: { type: Type.BOOLEAN, description: "True if generally safe to eat" }
            },
            required: ["foodName", "healthScore", "calories", "ingredients", "pros", "cons", "recommendation", "isSafe"]
          },
        },
      });

      const data = JSON.parse(response.text);
      setSearchResult(data);
      if (user) {
        saveToHistory(data);
      }
    } catch (err) {
      console.error(err);
      setError("Sorry, an error occurred while searching for the food. Please try again.");
    } finally {
      setSearching(false);
    }
  };

  const calculateBMI = () => {
    const w = parseFloat(weight);
    const h = parseFloat(height) / 100; // convert cm to m

    if (w > 0 && h > 0) {
      const bmi = w / (h * h);
      let category = "";
      let color = "";

      if (bmi < 18.5) {
        category = "Underweight";
        color = "text-blue-500";
      } else if (bmi < 25) {
        category = "Normal weight";
        color = "text-green-500";
      } else if (bmi < 30) {
        category = "Overweight";
        color = "text-yellow-500";
      } else {
        category = "Obese";
        color = "text-red-500";
      }

      setBmiResult({ value: parseFloat(bmi.toFixed(1)), category, color });
    }
  };

  const resetFood = () => {
    setImage(null);
    setResult(null);
    setError(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-warm-bg text-olive">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-olive border-t-transparent rounded-full animate-spin"></div>
          <p className="font-medium animate-pulse">Loading Cunto Hubin...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20 bg-warm-bg text-gray-900">
      {/* Floating Auth Corner */}
      <div className="fixed top-4 right-4 z-[60]">
        {!loading && (
          user ? (
            <div className="flex items-center gap-3 bg-white/90 backdrop-blur-md px-3 py-1.5 rounded-full border border-gray-200 shadow-lg transition-all hover:shadow-xl group">
              <div className="w-8 h-8 rounded-full overflow-hidden border border-olive/20 group-hover:scale-110 transition-transform">
                <img src={user.photoURL || ''} alt={user.displayName || 'User'} referrerPolicy="no-referrer" />
              </div>
              <span className="hidden md:block font-bold text-sm text-gray-700">{user.displayName?.split(' ')[0]}</span>
              <button 
                onClick={handleLogout}
                className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                title="Logout"
              >
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <button 
              onClick={handleLogin}
              className="flex items-center gap-2 bg-olive text-white px-5 py-3 rounded-full font-bold transition-all hover:scale-105 active:scale-95 shadow-xl shadow-olive/20"
            >
              <LogIn size={18} />
              <span className="hidden sm:inline">Sign In</span>
            </button>
          )
        )}
      </div>

      {/* Header */}
      <header className="py-4 px-4 md:px-8 bg-white/80 backdrop-blur-md sticky top-0 z-50 border-b border-gray-100 shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-olive rounded-xl flex items-center justify-center text-white">
                <ShieldCheck size={24} />
              </div>
              <h1 className="text-2xl font-bold italic serif tracking-tight text-olive">Cunto Hubin</h1>
            </div>

            <nav className="hidden lg:flex bg-gray-100 p-1 rounded-xl overflow-x-auto">
              <NavButton active={activeTab === 'food'} onClick={() => setActiveTab('food')} icon={<Scan size={18} />} label="Scan" />
              <NavButton active={activeTab === 'search'} onClick={() => setActiveTab('search')} icon={<Search size={18} />} label="Search" />
              <NavButton active={activeTab === 'bmi'} onClick={() => setActiveTab('bmi')} icon={<Calculator size={18} />} label="BMI" />
              {user && <NavButton active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon={<History size={18} />} label="History" />}
            </nav>
          </div>

          {/* Spacer for the fixed auth button in the corner */}
          <div className="hidden md:block w-32"></div>
        </div>
        
        {/* Mobile Nav */}
        <nav className="flex lg:hidden bg-gray-100 p-1 rounded-xl mt-4 overflow-x-auto w-full">
          <NavButton active={activeTab === 'food'} onClick={() => setActiveTab('food')} icon={<Scan size={18} />} label="Scan" />
          <NavButton active={activeTab === 'search'} onClick={() => setActiveTab('search')} icon={<Search size={18} />} label="Search" />
          <NavButton active={activeTab === 'bmi'} onClick={() => setActiveTab('bmi')} icon={<Calculator size={18} />} label="BMI" />
          {user && <NavButton active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon={<History size={18} />} label="History" />}
        </nav>
      </header>

      <main className="max-w-4xl mx-auto px-4 mt-8">
        <AnimatePresence mode="wait">
          {activeTab === 'food' && (
            <motion.div
              key="food-tab"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
            >
              {!image ? (
                <section className="text-center py-12">
                  <h2 className="text-4xl md:text-6xl font-bold serif leading-tight mb-6">
                    Verify what you <span className="text-olive italic">eat</span> today.
                  </h2>
                  <p className="text-lg text-gray-600 mb-10 max-w-2xl mx-auto leading-relaxed">
                    Take a photo of your food to get accurate nutritional info, 
                    health benefits, and even important warnings.
                  </p>

                  <div className="flex flex-col md:flex-row gap-4 justify-center items-center">
                    <motion.button
                      onClick={() => fileInputRef.current?.click()}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className="group relative flex items-center gap-3 bg-olive text-white px-8 py-4 rounded-2xl font-semibold transition-all shadow-xl shadow-olive/20 overflow-hidden"
                    >
                      <motion.div 
                        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -skew-x-12 w-full h-full"
                        animate={{ left: ["-100%", "200%"] }}
                        transition={{ repeat: Infinity, duration: 3, ease: "linear", repeatDelay: 2 }}
                      />
                      <Camera size={20} className="relative z-10" />
                      <span className="relative z-10">Take Photo / Upload</span>
                      <input 
                        type="file" 
                        ref={fileInputRef} 
                        onChange={handleImageUpload} 
                        accept="image/*" 
                        className="hidden" 
                      />
                    </motion.button>
                    {!user && (
                      <div className="flex items-center gap-2 text-xs font-bold text-gray-400 uppercase tracking-widest mt-4 md:mt-0">
                        <Info size={14} />
                        Sign in to save history
                      </div>
                    )}
                  </div>

                  <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
                    <FeatureCard 
                      icon={<Zap className="text-orange-500" />}
                      title="Quick Analysis"
                      desc="AI immediately analyzes your food."
                    />
                    <FeatureCard 
                      icon={<UtensilsCrossed className="text-green-500" />}
                      title="Nutrition Data"
                      desc="Learn about the calories and nutrients in your food."
                    />
                    <FeatureCard 
                      icon={<ShieldCheck className="text-blue-500" />}
                      title="Health Check"
                      desc="Is it safe? We'll tell you about any risks."
                    />
                  </div>
                </section>
              ) : (
                <section className="space-y-8">
                  <div className="relative rounded-3xl overflow-hidden aspect-video bg-gray-200 shadow-2xl">
                    <img src={image} alt="Uploaded food" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    
                    {/* Scanning Animation */}
                    {analyzing && (
                      <div className="absolute inset-0 pointer-events-none">
                        <motion.div 
                          className="absolute left-0 right-0 h-1 bg-olive/50 shadow-[0_0_15px_rgba(90,90,64,0.8)] z-10"
                          initial={{ top: "0%" }}
                          animate={{ top: "100%" }}
                          transition={{ 
                            repeat: Infinity, 
                            duration: 2, 
                            ease: "linear" 
                          }}
                        />
                        <div className="absolute inset-0 bg-gradient-to-b from-olive/5 via-transparent to-olive/5 animate-pulse" />
                      </div>
                    )}
                    
                    <button 
                      onClick={resetFood}
                      className="absolute top-4 right-4 bg-white/90 p-2 rounded-full shadow-md hover:bg-white transition-colors z-20"
                    >
                      <RefreshCw size={20} className="text-gray-600" />
                    </button>
                  </div>

                  {!result && !analyzing && (
                    <div className="flex justify-center">
                      <motion.button
                        onClick={analyzeFood}
                        whileHover={{ scale: 1.05, y: -4 }}
                        whileTap={{ scale: 0.95 }}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="relative flex items-center gap-3 bg-olive text-white px-10 py-5 rounded-2xl font-bold text-xl shadow-2xl shadow-olive/30 overflow-hidden group"
                      >
                        <motion.div 
                          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -skew-x-12 w-full h-full"
                          animate={{ left: ["-100%", "200%"] }}
                          transition={{ repeat: Infinity, duration: 2, ease: "linear", repeatDelay: 1 }}
                        />
                        <span className="relative z-10 flex items-center gap-3">
                          Analyze Food
                          <ArrowRight size={24} className="group-hover:translate-x-1 transition-transform" />
                        </span>
                      </motion.button>
                    </div>
                  )}

                  {analyzing && (
                    <div className="flex flex-col items-center py-12 space-y-4">
                      <div className="w-16 h-16 border-4 border-olive border-t-transparent rounded-full animate-spin"></div>
                      <p className="text-lg font-medium text-olive animate-pulse">Analyzing food now...</p>
                    </div>
                  )}

                  {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 p-6 rounded-2xl flex items-center gap-4">
                      <AlertTriangle size={24} />
                      <p>{error}</p>
                    </div>
                  )}

                  {result && (
                    <motion.div 
                      key="result-display"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-8"
                    >
                      <FoodDetails result={result} />
                      <div className="flex gap-4">
                        <button 
                          onClick={resetFood}
                          className="flex-1 py-4 rounded-2xl border-2 border-gray-200 text-gray-500 font-bold hover:bg-gray-50 transition-colors"
                        >
                          Analyze another food
                        </button>
                        {user && (
                          <div className="flex items-center gap-2 bg-green-50 text-green-700 px-6 rounded-2xl font-medium border border-green-100">
                            <CheckCircle2 size={18} />
                            Saved to history
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </section>
              )}
            </motion.div>
          )}

          {activeTab === 'search' && (
            <motion.div
              key="search-tab"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.2 }}
              className="space-y-8"
            >
              <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100 max-w-2xl mx-auto w-full">
                <div className="text-center mb-8">
                  <div className="w-16 h-16 bg-olive/10 text-olive rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Search size={32} />
                  </div>
                  <h2 className="text-3xl font-bold serif mb-2">Search Food Database</h2>
                  <p className="text-gray-500">Manually look up nutritional details for any dish or ingredient.</p>
                </div>

                <div className="relative group">
                  <input 
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && searchFood()}
                    placeholder="Search for food (e.g., Avocado Toast, Pizza...)"
                    className="w-full pl-14 pr-6 py-5 rounded-[1.5rem] bg-gray-50 border-2 border-transparent focus:border-olive focus:bg-white transition-all outline-none text-lg"
                  />
                  <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-olive transition-colors" size={24} />
                  <button 
                    onClick={searchFood}
                    disabled={searching || !searchQuery.trim()}
                    className="absolute right-3 top-1/2 -translate-y-1/2 bg-olive text-white p-3 rounded-2xl shadow-lg shadow-olive/20 hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:hover:scale-100"
                  >
                    {searching ? <RefreshCw className="animate-spin" size={20} /> : <ArrowRight size={20} />}
                  </button>
                </div>
              </div>

              {searching && (
                <div className="flex flex-col items-center py-12 space-y-4">
                  <div className="w-16 h-16 border-4 border-olive border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-lg font-medium text-olive animate-pulse">Searching database...</p>
                </div>
              )}

              {error && activeTab === 'search' && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-6 rounded-2xl flex items-center gap-4 max-w-2xl mx-auto">
                  <AlertTriangle size={24} />
                  <p>{error}</p>
                </div>
              )}

              {searchResult && !searching && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <FoodDetails result={searchResult} />
                </motion.div>
              )}
            </motion.div>
          )}

          {activeTab === 'bmi' && (
            <motion.div
              key="bmi-tab"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="max-w-2xl mx-auto"
            >
              <div className="bg-white p-8 md:p-12 rounded-[2.5rem] shadow-sm border border-gray-100">
                <div className="text-center mb-10">
                  <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Calculator size={32} />
                  </div>
                  <h2 className="text-3xl font-bold serif mb-2">BMI Calculator</h2>
                  <p className="text-gray-500">Enter your weight and height to find your health category.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-700 ml-1">Weight (kg)</label>
                    <input 
                      type="number" 
                      value={weight}
                      onChange={(e) => setWeight(e.target.value)}
                      placeholder="e.g. 70"
                      className="w-full px-5 py-4 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-olive focus:bg-white transition-all outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-700 ml-1">Height (cm)</label>
                    <input 
                      type="number" 
                      value={height}
                      onChange={(e) => setHeight(e.target.value)}
                      placeholder="e.g. 175"
                      className="w-full px-5 py-4 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-olive focus:bg-white transition-all outline-none"
                    />
                  </div>
                </div>

                <button 
                  onClick={calculateBMI}
                  disabled={!weight || !height}
                  className="w-full py-5 bg-olive text-white rounded-2xl font-bold text-lg shadow-lg shadow-olive/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:hover:scale-100 mb-8"
                >
                  Calculate your BMI
                </button>

                {bmiResult && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="p-8 rounded-3xl bg-gray-50 border border-gray-100 text-center"
                  >
                    <p className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-2">Your result is</p>
                    <div className={`text-6xl font-bold mb-2 ${bmiResult.color}`}>
                      {bmiResult.value}
                    </div>
                    <div className={`text-xl font-bold italic serif ${bmiResult.color}`}>
                      {bmiResult.category}
                    </div>
                    
                    <div className="mt-8 pt-8 border-t border-gray-200">
                      <div className="flex justify-between text-xs font-bold text-gray-400 mb-4 px-2">
                        <span>Low weight</span>
                        <span>Normal</span>
                        <span>Over</span>
                        <span>Obese</span>
                      </div>
                      <div className="h-4 w-full bg-gray-200 rounded-full flex overflow-hidden">
                        <div className="h-full w-[18.5%] bg-blue-400"></div>
                        <div className="h-full w-[25%] bg-green-400"></div>
                        <div className="h-full w-[25%] bg-yellow-400"></div>
                        <div className="h-full w-[31.5%] bg-red-400"></div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>

              <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
                <InfoBox title="What is BMI?" desc="BMI is a measurement used to determine if your weight corresponds to your height." />
                <InfoBox title="Why do you need it?" desc="Use this calculator to monitor your weight in the future." />
              </div>
            </motion.div>
          )}

          {activeTab === 'history' && (
            <motion.div
              key="history-tab"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-6"
            >
              <div className="flex justify-between items-end mb-4">
                <h2 className="text-3xl font-bold serif">Your History</h2>
                <button onClick={fetchHistory} className="text-olive hover:underline text-sm font-bold flex items-center gap-1">
                  <RefreshCw size={14} /> Refresh
                </button>
              </div>

              {history.length === 0 ? (
                <div className="bg-white p-12 rounded-[2.5rem] text-center border border-gray-100">
                  <div className="w-16 h-16 bg-gray-50 text-gray-300 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <History size={32} />
                  </div>
                  <h3 className="text-xl font-bold mb-2">No history yet</h3>
                  <p className="text-gray-400 max-w-sm mx-auto">Start scanning food to see your analysis history here.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {history.map((record) => (
                    <motion.div 
                      key={record.id}
                      initial={{ opacity: 1 }}
                      className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:shadow-md transition-all cursor-pointer"
                      onClick={() => {
                        setResult(record);
                        setActiveTab('food');
                        setImage(null); // Clear image to show result view
                      }}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${record.healthScore > 70 ? 'bg-green-100 text-green-600' : record.healthScore > 40 ? 'bg-yellow-100 text-yellow-600' : 'bg-red-100 text-red-600'}`}>
                          <UtensilsCrossed size={24} />
                        </div>
                        <div>
                          <h4 className="font-bold text-lg">{record.foodName}</h4>
                          <div className="flex items-center gap-2 text-xs text-gray-400 font-bold uppercase tracking-widest">
                            <span>{record.timestamp?.toDate ? record.timestamp.toDate().toLocaleDateString() : 'Recent'}</span>
                            <span>•</span>
                            <span>{record.calories} Cal</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 w-full md:w-auto justify-between">
                        <div className="text-right">
                          <div className="text-sm font-bold text-gray-400 uppercase tracking-tighter">Score</div>
                          <div className={`text-xl font-black ${record.healthScore > 70 ? 'text-green-500' : record.healthScore > 40 ? 'text-yellow-500' : 'text-red-500'}`}>{record.healthScore}</div>
                        </div>
                        <ChevronRight className="text-gray-300" />
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer Info */}
      <footer className="mt-20 py-10 px-4 text-center border-t border-gray-100">
        <p className="text-sm text-gray-400">
          Cunto Hubin powered by AI. Note: This information is for awareness only.
        </p>
      </footer>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button 
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all shrink-0 ${active ? 'bg-white text-olive shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function FoodDetails({ result }: { result: AnalysisResult }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h3 className="text-sm uppercase tracking-widest text-gray-400 font-bold mb-1">Food Name</h3>
            <p className="text-3xl font-bold serif">{result.foodName}</p>
          </div>
          <div className={`p-3 rounded-2xl ${result.isSafe ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {result.isSafe ? <CheckCircle2 size={32} /> : <AlertTriangle size={32} />}
          </div>
        </div>

        <div className="mb-8">
          <div className="flex justify-between items-end mb-2">
            <span className="text-sm font-bold text-gray-500 uppercase tracking-tighter">Health Score</span>
            <span className="text-2xl font-bold text-olive">{result.healthScore}/100</span>
          </div>
          <div className="h-3 w-full bg-gray-100 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${result.healthScore}%` }}
              className={`h-full ${result.healthScore > 70 ? 'bg-green-500' : result.healthScore > 40 ? 'bg-yellow-500' : 'bg-red-500'}`}
            />
          </div>
        </div>

        <div className="flex items-center gap-2 mb-8">
          <span className="bg-gray-100 px-4 py-2 rounded-xl font-mono text-sm font-bold">
            {result.calories} Calories
          </span>
        </div>

        <div>
          <h4 className="flex items-center gap-2 font-bold mb-4 text-gray-700">
            <Info size={16} />
            Ingredients
          </h4>
          <div className="flex flex-wrap gap-2">
            {result.ingredients.map((ing, i) => (
              <span key={i} className="bg-warm-bg px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200">
                {ing}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <div className="bg-green-50 p-6 rounded-3xl border border-green-100">
          <h4 className="font-bold text-green-800 mb-3">Health Benefits</h4>
          <ul className="space-y-2">
            {result.pros.map((pro, i) => (
              <li key={i} className="flex items-start gap-2 text-green-700 text-sm">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                {pro}
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-orange-50 p-6 rounded-3xl border border-orange-100">
          <h4 className="font-bold text-orange-800 mb-3">Warnings / Risks</h4>
          <ul className="space-y-2">
            {result.cons.map((con, i) => (
              <li key={i} className="flex items-start gap-2 text-orange-700 text-sm">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                {con}
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-olive p-8 rounded-3xl text-white shadow-xl shadow-olive/10">
          <h4 className="text-xs uppercase tracking-[0.2em] font-bold opacity-70 mb-2">Recommendation</h4>
          <p className="text-xl serif italic font-medium leading-relaxed">
            "{result.recommendation}"
          </p>
        </div>
      </div>
    </div>
  );
}

function FeatureCard({ icon, title, desc }: { icon: React.ReactNode, title: string, desc: string }) {
  return (
    <div className="p-6 bg-white rounded-3xl border border-gray-50 shadow-sm transition-all hover:shadow-md">
      <div className="mb-4">
        {icon}
      </div>
      <h3 className="font-bold mb-2 text-gray-800">{title}</h3>
      <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
    </div>
  );
}

function InfoBox({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="bg-white/50 p-6 rounded-3xl border border-gray-100">
      <h4 className="font-bold text-gray-800 mb-1">{title}</h4>
      <p className="text-sm text-gray-500">{desc}</p>
    </div>
  );
}
