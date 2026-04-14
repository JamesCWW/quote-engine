import CalibrationForm from './_components/CalibrationForm';

export const metadata = { title: 'Calibration — BespokeQuote' };

export default function CalibrationPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Engine Calibration</h1>
        <p className="text-sm text-gray-500 mt-1">
          Paste a past quote, enter what you actually charged, and see how the deterministic
          engine compares. Use this constantly while building the engine.
        </p>
      </div>
      <CalibrationForm />
    </div>
  );
}
